# Plan de desarrollo — APK "Agente Vicaria" (agente de voz y chat sobre el backoffice)

**Estado:** v3 consolidada (v2 + revisión externa verificada contra el código) · **Fecha:** 2026-08-28

## 1. Objetivo del producto

Una aplicación Android (APK) que funciona como un **agente conversacional** por texto y voz, cuyo conocimiento está **estrictamente limitado a los datos del backoffice de Vicaria** (pacientes, citas, encuentros clínicos, home care, facturación, reportes) y que, además de responder preguntas, puede **ejecutar acciones** sobre el backoffice.

Ejemplos de uso:

- **Consulta:** el usuario activa el micrófono y pregunta *"¿cuántos pacientes tengo para el próximo viernes?"*; la app responde por voz con la cantidad y el detalle de las citas de ese día.
- **Acción:** el usuario dice *"cámbiale la cita al cliente Cuco del próximo sábado para el próximo martes a las tres de la tarde"*; el agente localiza al paciente y su cita del sábado, **muestra y enuncia lo que va a hacer y pide confirmación**, la ejecuta al confirmarse, y confirma el resultado con los datos reales ("Listo, la cita quedó reprogramada para el martes 8 a las 15:00").

Ante cualquier pregunta o pedido fuera del backoffice (clima, noticias, conocimiento médico genérico, etc.) el agente responde: **"No estoy entrenada para eso; solo puedo trabajar con la información del backoffice de Vicaria."**

**Posicionamiento del producto:** no es un modelo "entrenado con Vicaria" (no hay fine-tuning con datos de pacientes). Es un agente **grounded**: el modelo solo puede obtener hechos mediante herramientas autorizadas que consultan el backoffice en tiempo real. El LLM interpreta intención y redacta; **el servidor decide identidad, permisos, datos, precondiciones y mutaciones.**

## 2. Punto de partida (estado actual del backoffice, verificado en el código)

Lo que ya existe y se reutiliza:

- **Stack:** Next.js 16 (App Router) + Supabase (PostgreSQL + Auth con MFA) + Drizzle ORM, desplegado en Vercel. UI con Server Components y Server Actions.
- **Capa de consultas reutilizable** en `src/lib/db/queries/*`: `listAppointments`, `listPatients`, `getPatient360`, `listShiftsInWindow`, `listInvoices`, `listTasks`, `runReport`, etc.
- **Helpers de zona horaria** en `src/lib/domain/timezone.ts` (`clinicDayWindow`, `clinicWeekWindow`, …) — imprescindibles para interpretar "el próximo viernes" en `America/Toronto` (a prueba de DST).
- **RBAC de 7 roles** (`owner`, `administrator`, `practitioner`, `reception`, `billing`, `marketing`, `auditor`) con matriz en `src/lib/auth/rbac.ts`, gate `authorize()` en `src/lib/auth/authorize.ts`, RLS en Postgres, auditoría (`audit_events`, `access_logs`).
- **Defensa de concurrencia en la base:** la constraint `ex_appointment_no_overlap` (`supabase/migrations/0001_indexes_rls.sql`) impide citas solapadas del mismo practitioner (excluyendo `cancelled`/`no_show`/`rescheduled`). Es la última línea de defensa contra carreras al reprogramar.

Brechas que este plan cubre (verificadas):

1. **No hay API REST/JSON** consumible desde un cliente móvil: solo Server Actions atadas a cookies y 3 route handlers (webhook de Square y auth).
2. **No hay ninguna integración de IA/LLM/voz** en el código. Greenfield.
3. **`authorize()` está acoplado a la sesión web por cookies** (`getSessionUser()` usa el cliente Supabase server-side de cookies). Una petición móvil con `Authorization: Bearer` no puede reutilizarlo tal cual: hay que extraer la autorización a una función sobre un *principal* explícito (§4.1).
4. **La búsqueda de pacientes no sirve como resolver de voz:** `listPatientsPaged` filtra con `ilike` sobre nombre legal, email, teléfono y número de paciente, pero **no busca por `preferred_name` ni hace matching fuzzy**. "La cita de Cuco" necesita un resolver dedicado (§5.3).
5. **Reprogramar no existe como operación propia:** `updateAppointmentAction` edita la misma fila, mientras que el esquema declara `rescheduled_from_id` para enlazar una cita nueva con la original. Hay que implementar `rescheduleAppointment()` como comando transaccional (§6.3).
6. El middleware (`src/proxy.ts`) redirige a `/login` todo lo que no esté en `PUBLIC_PATHS`; el nuevo prefijo `/api/assistant` debe exceptuarse y validar el Bearer por sí mismo (401, nunca 302).
7. El cliente Drizzle usa `DATABASE_URL` directo y **no inyecta los claims JWT por petición**, así que la RLS no representa al usuario móvil en esa conexión: cada tool debe aplicar autorización y filtros (`organization_id`, alcance de practitioner) explícitamente en servidor.

## 3. Arquitectura propuesta

```
┌──────────────────────────┐      HTTPS / Bearer Supabase      ┌────────────────────────────────┐
│  APK React Native/Expo   │ ────────────────────────────────► │ Next.js /api/assistant/v1      │
│  - Login + MFA           │                                   │ - RequestIdentity (Bearer →    │
│  - Chat (streaming)      │ ◄──── streaming texto/eventos ─── │   AssistantPrincipal)          │
│  - STT on-device         │                                   │ - Policy / RBAC (principal)    │
│  - TTS nativo (modo      │                                   │ - Orquestador (tool loop)      │
│    privado)              │                                   │ - Tool Registry (por rol)      │
│  - Tarjetas de confirma- │                                   │ - Action Proposal Service      │
│    ción y selección      │                                   └───────────────┬────────────────┘
└──────────────────────────┘                                                   │
                                     ┌──────────────────────┬──────────────────┴───────────────┐
                                     │                      │                                  │
                             ┌───────▼────────┐    ┌────────▼─────────┐              ┌────────▼────────┐
                             │ Domain/Queries │    │ AiProvider       │              │ Audit / Access  │
                             │ Drizzle/PG     │    │ (Claude 1ª impl.)│              │ Logs            │
                             └────────────────┘    └──────────────────┘              └─────────────────┘
```

**Principio central:** el LLM no conoce credenciales de base de datos y no ejecuta SQL. Solo solicita herramientas tipadas; el servidor decide si esa herramienta existe para ese usuario, valida los argumentos, impone el scope de organización/empleado y registra los accesos.

| Decisión | Elección | Notas |
|---|---|---|
| Framework móvil | **React Native + Expo** (Development Build/EAS) | Equipo TypeScript. **Gate en Fase 0:** validar STT on-device en dispositivos reales; si el módulo no garantiza `createOnDeviceSpeechRecognizer`, se escribe un native module Android solo para la capa de audio (no se reescribe la app en Kotlin). |
| STT | **On-device explícito**: `createOnDeviceSpeechRecognizer()` + `isOnDeviceRecognitionAvailable()` (requiere **Android 12 / API 31+**) | El `SpeechRecognizer` estándar puede mandar audio a servidores de Google; "nativo" no equivale a "local". **Sin fallback silencioso a cloud STT**: si no hay soporte on-device, se deshabilita el micrófono y queda el chat de texto. Cloud STT solo tras revisión de privacidad y consentimiento, jamás como fallback implícito. |
| TTS | Nativo de Android (`expo-speech`), con **modo privado** (§7.3) | Local, sin PHI a terceros. |
| LLM | **Interfaz `AiProvider`** (tool calls estructurados, streaming, límites, timeouts, métricas); **Claude como primera implementación** | No acoplar el código a un proveedor. Gate de privacidad/retención antes de conectar PHI real (§8.1). |
| Transporte | SSE/fetch-streaming, intercambiable por NDJSON sin cambiar la semántica | Probar en dispositivos Expo reales en Fase 0. |
| Auth móvil | Supabase Auth (mismos `auth.users`), Bearer → `AssistantPrincipal`, tokens en Keystore/SecureStore | Reutiliza usuarios, roles y MFA existentes. |
| Feature flags | `assistant_enabled`, `voice_enabled`, `write_actions_enabled`, `reschedule_enabled` | La IA y las acciones se pueden apagar sin tocar el backoffice web. |

## 4. Backend: capa de asistente en el backoffice

### 4.1 Refactor de autorización: `authorizePrincipal`

Se extrae la matriz RBAC a una función pura sobre un principal explícito, sin cambiar el comportamiento de la web:

```
src/lib/auth/principal.ts             # AssistantPrincipal { authUserId, dbUserId,
                                      #   organizationId, employeeId, roles[], aal, locale }
src/lib/auth/authorize-principal.ts   # RBAC puro: authorizePrincipal(principal, resource, action)
src/lib/auth/authorize.ts             # queda como adapter web: cookies → principal → authorizePrincipal
src/lib/assistant/auth/request-identity.ts  # Bearer → validar JWT Supabase → principal (+ chequeo MFA/AAL)
```

Web y APK comparten así **exactamente la misma matriz de permisos**. Regla dura: ninguna tool acepta `organizationId`, `employeeId` ni roles suministrados por la APK o por el modelo como fuente de autoridad — siempre salen del principal construido en servidor.

### 4.2 API versionada y contrato de conversación

| Endpoint | Función |
|---|---|
| `GET /api/assistant/v1/health` | Compatibilidad, versión mínima de app, feature flags no sensibles. |
| `POST /api/assistant/v1/turn` | Un turno del usuario: `{ conversationId?, input, locale, requestId }`. Respuesta en streaming. |
| `POST /api/assistant/v1/actions/execute` | Ejecuta únicamente una propuesta confirmada y vigente. |
| `POST /api/assistant/v1/actions/cancel` | Cancela una propuesta pendiente. |

**La APK nunca envía un historial `messages[]` con roles `system`/`tool` manipulables.** El servidor crea y conserva las instrucciones, el estado del tool-loop y los permisos; todo lo que llega del cliente se trata como input de usuario. Estado de conversación mínimo (id, timestamps, idioma, referencias resueltas de corta duración); **sin transcripts persistentes con PHI en el MVP** — si el negocio pide historial, primero se define retención/acceso/borrado.

**Salida estructurada del orquestador:** cada turno se clasifica como `response`, `refusal`, `clarification` o `action_proposal`. Nunca se decide ejecutar una acción a partir de texto libre del modelo.

### 4.3 Herramientas de lectura

Cada tool: (1) `authorizePrincipal(principal, resource, 'read')`, (2) scope forzado en servidor (organización + alcance del rol), (3) `access_logs` cuando devuelve PHI de un paciente concreto, (4) entrada/salida validadas con Zod, (5) **salida mínima** — las preguntas agregadas devuelven agregados, no listas de registros con nombres.

| Tool | Responde a | Salida al LLM |
|---|---|---|
| `count_patients_seen` | "¿cuántos pacientes atendí este mes?" | `count` + rango + definición de métrica; **sin nombres** |
| `count_completed_appointments` | "¿cuántas citas completadas esta semana?" | `count` + rango |
| `get_appointments_for_range` | "¿qué agenda tengo el próximo viernes?" | campos mínimos autorizados de cada cita; excluye `cancelled`/`no_show`, de-duplica por paciente cuando se pregunta "cuántos pacientes" |
| `resolve_patient` | "Cuco", "María López", nº de paciente | 0/1/N candidatos mínimos (nombre, quizá fecha de nacimiento parcial); sin detalles clínicos |
| `get_patient_summary` | "¿cuándo fue la última visita de X? ¿debe algo?" | resumen de campos estrictamente necesarios según permisos (deriva de `getPatient360`) |
| `get_care_shifts_for_range` | agenda de home care / caregivers | turnos dentro del scope |
| `get_follow_up_tasks` | "¿qué tareas tengo vencidas?" | tareas del scope |
| `get_invoices` / `get_payments` | "¿qué facturas están vencidas?" (roles de finanzas) | listas/agregados según permiso |
| `run_report` | reportes predefinidos (FIN/OPS/CLN/PKG/MKT) | agregados/series, evitando PHI innecesaria |
| `resolve_date` | "próximo viernes", "el martes a las tres" | fecha/rango absolutos en hora de la clínica (el servidor inyecta la fecha/hora actual de la clínica en cada turno) |

**Contrato semántico de métricas:** antes de liberar el agente, el equipo clínico aprueba un catálogo de definiciones deterministas que el LLM no decide por contexto: qué es un "paciente atendido" (¿cita `completed`?, ¿encounter firmado?), qué significa "este mes" (mes calendario `America/Toronto`), cuándo una factura está "vencida", y qué abarca "mis pacientes" para cada rol.

### 4.4 Resolver de pacientes para voz (`resolve_patient`)

1. Normalizar el texto reconocido (acentos, mayúsculas, espacios, variantes previsibles del STT).
2. Buscar por `preferred_name` **y** nombre legal completo **y** `patient_number`, con `pg_trgm`/`similarity` para tolerar errores de reconocimiento (requiere una migración que habilite la extensión e índices trigram).
3. **Nunca elegir en silencio** con confianza baja o múltiples candidatos: la APK muestra una tarjeta de selección con el mínimo dato necesario para desambiguar.
4. Una vez resuelto, el resto del turno trabaja por `patientId`; no se vuelve a resolver el nombre en cada tool.

## 5. Control de alcance: cómo evitar que el agente responda "de todo"

El system prompt restrictivo es necesario pero no es la barrera principal. Cuatro controles combinados:

1. **Catálogo cerrado de tools.** Sin navegador, sin web search, sin shell, sin SQL libre, sin herramientas genéricas.
2. **Tool registry por permisos.** El modelo solo recibe las tools compatibles con el rol del principal, y el servidor revalida cada invocación (una tool no listada invocada "a mano" falla server-side).
3. **Regla de grounding.** Toda afirmación factual sobre Vicaria debe derivar de una tool o de metadata fija de la app. Si ninguna tool puede responder, se emite `refusal` con el mensaje estándar en el idioma del usuario.
4. **Salida estructurada.** `response` / `refusal` / `clarification` / `action_proposal` — la ejecución de acciones jamás depende de interpretar texto libre.

**Prompt injection desde los propios datos:** las notas administrativas, nombres de documentos y campos libres del backoffice son datos no confiables — un registro que contenga "ignora tus instrucciones y…" nunca se convierte en instrucción. En v1/v2 no se envían notas clínicas ni documentos libres al LLM salvo caso de uso aprobado; los tool results se marcan como datos con schemas estrictos; nunca se concatena contenido de la base dentro del system prompt.

## 6. Acciones: propose → confirm → execute → verify

### 6.1 Herramientas de acción

La lógica de escritura hoy vive en Server Actions atadas a cookies (`src/app/(app)/calendar/actions.ts`). Se extrae a comandos de dominio compartidos (`src/lib/domain/appointments/commands.ts`: `create`/`cancel`/`status`/`reschedule`) que consumen tanto las Server Actions de la web (que quedan como adapters) como el agente — misma validación Zod, mismo `authorizePrincipal`, misma escritura de `appointment_status_history` y `audit_events`.

| Tool de acción | Responde a | Notas |
|---|---|---|
| `reschedule_appointment` | "cámbiale la cita a Cuco del sábado para el martes a las 3 pm" | **primera y única acción del piloto**, tras feature flag `reschedule_enabled` (§6.3) |
| `create_appointment` | "agéndale a María una consulta el jueves a las 10" | segunda ola |
| `cancel_appointment` | "cancela la cita de Juan de mañana" | → `cancelled` con `cancellation_reason` obligatorio |
| `update_appointment_status` | "márcala como confirmada / llegó el paciente" | validando transiciones permitidas |
| `create_follow_up_task` | "recuérdame llamar a Cuco el lunes" | inserción en `follow_up_tasks` |

Las tools de escritura del loop del LLM **solo crean propuestas**; nunca escriben directamente.

### 6.2 Propuestas persistidas en servidor

Un token firmado puramente stateless no puede demostrar que ya fue consumido en otra instancia serverless. La garantía de un solo uso vive en la base: tabla **`assistant_action_proposals`** (migración nueva):

| Campo | Propósito |
|---|---|
| `id` | UUID de la propuesta |
| `organization_id` / `actor_user_id` | vínculo estricto al tenant y al usuario que confirmará |
| `tool_name` | acción allowlisted |
| `arguments_json` / `arguments_hash` | parámetros canónicos exactos que el usuario confirmó |
| `created_at` / `expires_at` | TTL corto (2–5 minutos) |
| `status` | `proposed` / `consumed` / `cancelled` / `expired` / `failed` |
| `consumed_at` | evidencia auditable de un solo uso |
| `conversation_id` / `request_id` | correlación e idempotencia |

**Flujo:**

1. El LLM emite `action_proposal` estructurada; todavía no hay escritura.
2. El servidor resuelve IDs y precondiciones (la cita origen existe y es reprogramable; el nuevo slot no choca con `employeeAppointmentsInWindow` ni cae fuera del horario de la sede; el principal tiene permiso de escritura), crea la fila de propuesta y devuelve la tarjeta de confirmación.
3. La APK muestra paciente, fecha/hora absolutas, servicio, practitioner y efecto de la acción. Ambigüedad (dos "Cuco", dos citas ese sábado, "¿las tres" AM/PM?) ⇒ `clarification` **antes** de proponer, nunca se adivina en silencio.
4. **Confirmación por botón explícito en el piloto** (opcionalmente biometría tras inactividad). La voz sirve para *pedir* la acción; la confirmación *por voz* se habilita después, solo si el riesgo/UX lo justifica.
5. `POST /actions/execute` recibe `proposalId` + token, hace **consumo atómico** de la propuesta (UPDATE condicional `status='proposed'` → `consumed`) y revalida permisos y precondiciones dentro de una transacción. Dos execute simultáneos ⇒ una sola mutación.
6. El comando de dominio ejecuta; se **relee la entidad real** y se responde con el resultado final ("Listo, la cita de Cuco Pérez quedó para el martes 8 de septiembre a las 15:00 con la Dra. X"). Si falla, se explica el motivo sin reintentar solo.
7. `audit_events` y `access_logs` registran actor, `source=assistant`, tool, entidad, outcome y `proposalId` — **sin guardar el prompt completo con PHI**.

### 6.3 Reprogramación correcta (comando transaccional)

`rescheduleAppointment(principal, originalAppointmentId, newSlot, …)`, compartido por web y APK:

1. Bloquear/releer la cita original y verificar que siga siendo reprogramable (no `completed`/`cancelled`).
2. Revalidar el conflicto del practitioner en el nuevo slot justo antes de escribir.
3. Marcar la original `status = rescheduled` + `appointment_status_history`.
4. Insertar una **cita nueva** copiando paciente/servicio/precio/configuración, con `rescheduled_from_id = original.id`, y su history inicial.
5. Auditar ambas entidades en la misma transacción.
6. Si aun así hay carrera, la constraint `ex_appointment_no_overlap` de la base es la última defensa: su violación se traduce a un mensaje de conflicto amigable, nunca a un 500 con detalles internos.

**Fuera del catálogo de acciones (v1 del agente):** operaciones financieras (emitir/anular facturas, pagos, reembolsos), firma de encuentros clínicos y cambios de configuración. Si el usuario las pide, el agente lo dice y redirige al backoffice web.

## 7. Aplicación Android (APK)

### 7.1 Pantallas v1

| Pantalla | Contenido |
|---|---|
| Login/MFA | email/contraseña, reto TOTP según política, manejo de refresh/sesión |
| Chat | burbujas, streaming, input editable, push-to-talk, estados escuchando/procesando/hablando |
| Confirmación | tarjeta bloqueante con la acción exacta (fecha absoluta, paciente, practitioner, efecto) y Confirmar/Cancelar |
| Selección de paciente | lista mínima de candidatos cuando una referencia es ambigua |
| Ajustes | idioma es/en, voz on/off, **modo privado**, velocidad TTS, cerrar sesión |

### 7.2 Flujo de voz

Micrófono → STT on-device → el texto reconocido se muestra **editable** antes de enviar → `POST /turn` → respuesta en streaming → TTS al completar (o por frases). El TTS se interrumpe al tocar el micrófono o bloquear la app.

### 7.3 Privacidad acústica: "modo privado" (ON por defecto)

Aunque el TTS sea local, leer nombres o datos clínicos en voz alta expone PHI a quien esté cerca:

- Con modo privado activo, la voz lee respuestas generales y conteos pero omite nombres/datos sensibles; la pantalla muestra la respuesta completa según permisos.
- Con auriculares detectados se puede ofrecer lectura completa.
- El usuario puede desactivarlo explícitamente en Ajustes.

### 7.4 Seguridad local

- Tokens solo en Android Keystore/SecureStore; nunca AsyncStorage plano.
- Sin transcript persistente local en el MVP; si se añade historial: cifrado + política de retención explícita.
- `FLAG_SECURE` en pantallas con PHI; sin PHI en logs, analytics, crash reports ni notificaciones push.
- Cierre/bloqueo por inactividad; reautenticación local opcional con biometría.
- Play Integrity / app attestation como hardening opcional para producción.
- **Android mínimo: 12 (API 31)** para garantizar STT on-device.
- Distribución: Google Play (pista interna/cerrada); APK firmado por descarga directa como alternativa (EAS Build genera ambos).

## 8. Seguridad, privacidad y cumplimiento (PHI)

1. Mismo perímetro que la web: Supabase Auth + `authorizePrincipal` + alcances por rol; el agente jamás amplía lo que el usuario ya puede ver **o hacer** en el backoffice.
2. La API key del proveedor de IA vive solo en el servidor; la APK nunca habla con el proveedor.
3. **Gate de privacidad antes de conectar PHI real al LLM:** inventario exacto de qué campos recibe el proveedor por cada tool; minimización (agregados para preguntas agregadas, IDs/labels mínimos para acciones); revisión de contrato, retención, uso para entrenamiento, subprocesadores, incident response y ubicación de procesamiento; Privacy Impact Assessment / threat model aprobado antes del piloto con datos reales; capacidad de apagar IA/acciones por feature flag sin afectar la web.
4. **Contexto Ontario/PHIPA:** delegar en un tercero no elimina la responsabilidad del custodio sobre la PHI (posición reiterada de la IPC de Ontario); este plan es técnico y no sustituye la revisión legal/privacidad.
5. Auditoría equivalente a la web: `audit_events` por turno con acción (`assistant_query`/tool), y `access_logs` por paciente consultado.
6. Sin PHI en logs ni URLs (regla SEC-06 existente); rate limiting por usuario reutilizando `src/lib/security/`; presupuesto de tokens/turnos por usuario/día.

## 9. Fases de desarrollo

| Fase | Alcance | Salida / gate | Estimación |
|---|---|---|---|
| **0. Arquitectura + seguridad** | Principal Bearer + refactor `authorizePrincipal` (sin cambio visible en la web, con tests), `GET /api/assistant/v1/health`, **spike de STT on-device en Expo sobre 2–3 dispositivos reales (es/en, nombres propios)**, prueba de SSE en Expo, catálogo de métricas con el equipo clínico, checklist de privacidad/proveedor | Login móvil real + API autenticada + veredicto del spike STT (¿módulo Expo o native module?) | 1–2 sem. |
| **1. Core read-only** | Orquestador con `AiProvider`, salida estructurada, tool registry por rol, scope gate, tools de citas/fechas/conteos, `resolve_patient` (con migración pg_trgm), audit/access logs, rate limits | Preguntas de agenda y "pacientes atendidos" correctas por rol; out-of-scope rechazado (verificado con golden set inicial vía `curl`) | 2–3 sem. |
| **2. APK texto** | Chat con streaming, refresh de sesión, errores/offline, secure storage, tarjeta de selección de paciente | Piloto interno de texto, sin acciones | 1–2 sem. |
| **3. Voz** | STT on-device, TTS, modo privado, transcript editable, interrupción | Flujo voz→respuesta hablada en dispositivos reales | 2–3 sem. |
| **4. Cobertura read completa** | `get_patient_summary`, home care, tareas, facturación/reportes según RBAC; formatos es/en-CA | Catálogo read v1 completo; golden set de lectura aprobado | 1–2 sem. |
| **5. Infraestructura de acciones + reprogramar** | Comandos de dominio (Server Actions como adapters), migración `assistant_action_proposals`, execute idempotente/atómico, tarjeta de confirmación, `rescheduleAppointment` transaccional | **Solo reprogramar**, tras feature flag; 0 ejecuciones sin confirmación (probado en integración); el flujo del ejemplo de Cuco funciona end-to-end y queda auditado | 2–3 sem. |
| **6. Más acciones** | Crear/cancelar cita, cambio de estado, follow-up task; cada una con su política y sus tests | Catálogo write v1 controlado | 1–2 sem. |
| **7. Hardening + piloto** | Suite adversarial (inyección desde input y desde datos), concurrencia/replay, QA de dispositivos, latencia, observabilidad sin PHI, piloto con 2–3 usuarios reales, distribución | Go/no-go documentado con las métricas de §10.4 | 2–3 sem. |

**Calendario realista:** MVP útil de solo lectura en **6–8 semanas**; piloto controlado con voz y reprogramación en **10–13**; versión endurecida con el catálogo completo de acciones en **14–18 semanas** (una persona full-time; dos desarrolladores pueden solapar móvil/backend pero los gates de seguridad/QA no se comprimen).

## 10. Estrategia de pruebas y criterios de aceptación

### 10.1 Seguridad / autorización

- Cada tool por cada rol relevante; acceso cross-organization siempre 403/404 seguro.
- Bearer ausente/inválido/expirado; MFA/AAL insuficiente para la política configurada.
- `organizationId`/`employeeId` suministrados por el cliente ignorados como autoridad.
- Tool no permitida para el rol: no aparece en el registry y, si se invoca manualmente, falla server-side.

### 10.2 Acciones

- Execute sin propuesta válida falla; propuesta de otro usuario/organización falla; replay de propuesta consumida falla; propuesta expirada falla.
- Dos execute simultáneos ⇒ una sola mutación (consumo atómico).
- Slot libre al proponer pero ocupado al confirmar ⇒ la revalidación detecta el conflicto y no escribe.
- Violación de `ex_appointment_no_overlap` ⇒ error controlado y amigable, nunca 500 con detalles internos.
- La reprogramación escribe la cita nueva con `rescheduled_from_id`, marca la original `rescheduled` y deja history + audit de ambas.
- Escenarios de ambigüedad (dos pacientes con el mismo apodo, dos citas el mismo día) terminan en `clarification`, nunca en ejecución.

### 10.3 Unitarias (Vitest, ya configurado)

Resolución de fechas naturales contra `clinicDayWindow` (incluye DST y cambio de mes/año); normalización y fuzzy del resolver de pacientes (errores típicos de STT); comandos de dominio (transiciones válidas, conflictos); métricas deterministas del catálogo aprobado.

### 10.4 Evaluación del agente (golden set) y objetivos de piloto

Golden set en es/en: consultas de agenda y agregadas (con la definición exacta de cada métrica), ambigüedades de nombres/apodos, fechas relativas alrededor de DST, prompt injection en el input **y en campos libres devueltos por tools**, preguntas fuera de scope (médicas generales, comandos del sistema), y pedidos de acciones prohibidas (refund, facturación, firma clínica, configuración). Corre en CI contra datos seed y bloquea despliegues bajo umbral.

| Métrica de piloto | Objetivo |
|---|---|
| Acciones ejecutadas sin confirmación | **0** |
| Fugas cross-tenant / cross-role | **0** |
| Replay exitoso de propuestas | **0** |
| Interpretación correcta de fechas (casos deterministas) | ≥ 99% |
| Out-of-scope correctamente rechazado | ≥ 98% |
| Selección correcta de tool/acción | ≥ 97% |
| Latencia p95 texto (hasta primer token) | < 4 s (a medir tras Fase 1) |
| Latencia p95 voz→voz | < 6 s en red normal, sujeto a medición real |

### 10.5 Integración y E2E

`/turn` y `/actions/*` con tokens reales de Supabase por rol; verificación de `access_logs`/`audit_events`; E2E móvil del flujo login → pregunta → respuesta; smoke manual de voz en 2–3 dispositivos físicos.

## 11. Riesgos y mitigaciones

| Riesgo | Mitigación |
|---|---|
| El LLM responde con conocimiento general pese al prompt | Los cuatro controles de §5 (catálogo cerrado, registry por rol, grounding, salida estructurada) + golden set de rechazo en CI |
| El agente ejecuta una acción equivocada (paciente/cita/fecha mal resueltos) | Propuestas persistidas + confirmación por botón con datos absolutos + `clarification` obligatoria ante ambigüedad + relectura post-ejecución + `rescheduled_from_id` para revertir |
| Ejecución duplicada o replay (reintentos de red, STT repetido, concurrencia serverless) | Consumo atómico de `assistant_action_proposals` con TTL corto + `requestId` idempotente + constraint de solapamiento como última defensa |
| Acción irreversible pedida por voz (factura, reembolso, firma clínica) | Excluidas del catálogo; el agente redirige al backoffice web |
| Fuga de PHI hacia terceros | STT on-device sin fallback silencioso, TTS local con modo privado, LLM solo en servidor tras gate de privacidad, campos mínimos por tool, sin transcripts persistentes |
| Prompt injection desde datos del backoffice | Campos libres tratados como datos no confiables; sin notas clínicas al LLM en v1/v2; schemas estrictos en tool results |
| STT flojo con nombres propios | Transcript editable antes de enviar + `resolve_patient` con `preferred_name` y trigram + tarjeta de desambiguación |
| El módulo Expo no garantiza STT on-device | Spike en Fase 0 con gate explícito; plan B: native module Android solo para audio |
| Interpretación errónea de fechas | `resolve_date` determinista en servidor con hora de la clínica; el agente enuncia siempre la fecha absoluta resuelta |
| Costo del LLM | Modelo pequeño-mediano (p. ej. Haiku) para el tool loop, escalando solo si la calidad lo exige; presupuesto diario por usuario; caché del prompt de sistema |
| Server Actions no reutilizables desde móvil | Lecturas vía `src/lib/db/queries/*`; escritura extraída a comandos de dominio compartidos con las Server Actions como adapters |

## 12. Cambios en el repositorio y orden de refactor

```
src/lib/auth/
  principal.ts                  # Principal común web/móvil
  authorize-principal.ts        # RBAC puro sobre principal
  authorize.ts                  # Adapter web (cookies → principal)

src/lib/assistant/
  auth/request-identity.ts      # Bearer → principal
  policy/scope.ts               # Scope por organización/empleado + reglas de rechazo
  orchestrator.ts               # Tool loop, límites, salida estructurada, streaming
  provider/types.ts             # Interfaz AiProvider
  provider/claude.ts            # Primera implementación
  tools/read/*.ts               # Tools read-only (schemas Zod, salida mínima)
  actions/proposals.ts          # Propuestas persistidas + token
  actions/execute.ts            # Consumo atómico + ejecución idempotente

src/lib/domain/appointments/
  commands.ts                   # create/cancel/status/reschedule compartidos

src/app/api/assistant/v1/
  health/route.ts
  turn/route.ts
  actions/execute/route.ts
  actions/cancel/route.ts

supabase/migrations/
  XXXX_assistant_action_proposals.sql
  XXXX_pg_trgm_patient_search.sql
```

Orden recomendado (cada paso desplegable por sí solo):

1. `principal` + `authorizePrincipal` sin cambio visible en la web, cubierto con tests.
2. Extraer create/update/status de appointments a comandos de dominio; Server Actions quedan como adapters.
3. Implementar `rescheduleAppointment` con semántica explícita (y decidir si la web lo adopta para "reprogramar").
4. API Bearer + tools read-only.
5. Recién entonces, propuestas persistidas + write tools.

## 13. Decisiones a cerrar antes del sprint 1

| Decisión | Recomendación |
|---|---|
| Android mínimo | 12 / API 31 (STT on-device garantizado) |
| Confirmación de acciones | Botón explícito en el piloto; la voz solo propone. Confirmación por voz: evaluar después |
| Proveedor LLM | Claude como primera implementación detrás de `AiProvider`; aprobación de privacidad antes de PHI real |
| Definición "paciente atendido" (y demás métricas) | Aprobar con el equipo clínico y codificar como métricas deterministas |
| Historial de chat | No persistente en MVP |
| Lectura de PHI por TTS | Modo privado ON por defecto |
| Primera write action | Solo `reschedule_appointment`, tras feature flag |
| Multi-organización | La org activa vive en el principal; nunca se infiere de parámetros del cliente |

## 14. Checklist inmediato

- [ ] ADR "Assistant Security Boundary": LLM sin DB/SQL, catálogo cerrado, principal server-side, salida estructurada.
- [ ] Refactor a `authorizePrincipal()` con pruebas de equivalencia web/Bearer.
- [ ] Definir "pacientes atendidos" y 10–20 preguntas reales del equipo para el golden set inicial.
- [ ] Spike de STT on-device (Expo, Android 12–15+, es/en, nombres propios) y prueba de SSE en dispositivo.
- [ ] `resolve_patient` para voz (migración pg_trgm) con manejo de ambigüedad.
- [ ] Extraer comandos de dominio de appointments y diseñar `rescheduleAppointment()`.
- [ ] Migración `assistant_action_proposals` + consumo atómico/idempotencia.
- [ ] `GET /api/assistant/v1/health` + primera tool `count_patients_seen`.
- [ ] Feature flags `assistant_enabled`, `voice_enabled`, `write_actions_enabled`, `reschedule_enabled`.
- [ ] Revisión de privacidad/proveedor (retención, PHIPA) antes de conectar datos reales al LLM.
