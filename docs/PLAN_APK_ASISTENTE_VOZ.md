# Plan de desarrollo — APK "Agente Vicaria" (agente de voz y chat sobre el backoffice)

**Estado:** propuesta v2 (v1 + ejecución de acciones) · **Fecha:** 2026-08-28

## 1. Objetivo del producto

Una aplicación Android (APK) que funciona como un **agente conversacional** por texto y voz, cuyo conocimiento está **estrictamente limitado a los datos del backoffice de Vicaria** (pacientes, citas, encuentros clínicos, home care, facturación, reportes) y que, además de responder preguntas, puede **ejecutar acciones** sobre el backoffice.

Ejemplos de uso:

- **Consulta:** el usuario activa el micrófono y pregunta *"¿cuántos pacientes tengo para el próximo viernes?"*; la app responde por voz con la cantidad y el detalle de las citas de ese día.
- **Acción:** el usuario dice *"cámbiale la cita al cliente Cuco del próximo sábado para el próximo martes a las tres de la tarde"*; el agente localiza al paciente y su cita del sábado, **repite en voz alta lo que va a hacer y pide confirmación** ("Voy a mover la cita de Cuco Pérez del sábado 5 de septiembre a las 10:00 al martes 8 de septiembre a las 15:00, ¿confirmas?"), la ejecuta al recibir el "sí", y confirma el resultado ("Listo, la cita quedó reprogramada para el martes 8 a las 15:00").

Ante cualquier pregunta o pedido fuera del backoffice (clima, noticias, conocimiento médico genérico, etc.) el agente responde: **"No estoy entrenada para eso; solo puedo trabajar con la información del backoffice de Vicaria."**

## 2. Punto de partida (estado actual del backoffice)

Lo que ya existe y se reutiliza:

- **Stack:** Next.js 16 (App Router) + Supabase (PostgreSQL + Auth con MFA) + Drizzle ORM, desplegado en Vercel. UI con Server Components y Server Actions.
- **Capa de consultas reutilizable** en `src/lib/db/queries/*`: `listAppointments`, `listPatients`, `getPatient360`, `listShiftsInWindow`, `listInvoices`, `listTasks`, `runReport`, etc. Esta capa es el backend natural del asistente.
- **Helpers de zona horaria** en `src/lib/domain/timezone.ts` (`clinicDayWindow`, `clinicWeekWindow`, …) — imprescindibles para interpretar "el próximo viernes" correctamente en `America/Toronto` (a prueba de DST).
- **RBAC de 7 roles** (`owner`, `administrator`, `practitioner`, `reception`, `billing`, `marketing`, `auditor`) con matriz en `src/lib/auth/rbac.ts`, gate `authorize()` en `src/lib/auth/authorize.ts`, RLS en Postgres, auditoría (`audit_events`, `access_logs`).

Lo que **no** existe todavía (brechas que este plan cubre):

1. **No hay API REST/JSON** consumible desde un cliente móvil: solo Server Actions atadas a cookies y 3 route handlers (webhook de Square y auth). Hay que crear una capa `/api/assistant/*`.
2. **No hay ninguna integración de IA/LLM/voz** en el código. Es un desarrollo greenfield.
3. El middleware (`src/proxy.ts`) redirige a `/login` todo lo que no esté en `PUBLIC_PATHS`; habrá que exceptuar el nuevo prefijo de API y validar allí el token Bearer.
4. El cliente Drizzle usa `DATABASE_URL` directo (sin RLS efectiva), así que cada endpoint nuevo debe llamar `authorize()` y filtrar por `organization_id` y por alcance del practitioner por sí mismo.

## 3. Arquitectura propuesta

```
┌────────────────────────┐        HTTPS (Bearer = access token Supabase)
│  APK (React Native /   │ ─────────────────────────────────────────────┐
│  Expo)                 │                                              ▼
│  - Login Supabase      │                     ┌──────────────────────────────────────┐
│  - Chat UI             │   SSE (streaming)   │  vicaria_backoffice (Next.js/Vercel) │
│  - STT nativo (es/en)  │ ◄────────────────── │  /api/assistant/chat                 │
│  - TTS nativo (es/en)  │                     │   1. valida JWT Supabase + RBAC      │
└────────────────────────┘                     │   2. orquesta LLM con tool-use       │
                                               │   3. tools = wrappers tipados de     │
                                               │      src/lib/db/queries/* +          │
                                               │      authorize() + audit             │
                                               └───────────────┬──────────────────────┘
                                                               │
                                          ┌────────────────────┴───────────┐
                                          │ Claude API (tool use)          │  ← nunca ve la DB;
                                          │ Supabase Postgres (via Drizzle)│    solo resultados de tools
                                          └────────────────────────────────┘
```

Decisiones clave y su justificación:

| Decisión | Elección recomendada | Alternativa | Por qué |
|---|---|---|---|
| Framework móvil | **React Native + Expo** (genera APK/AAB) | Kotlin + Jetpack Compose | El equipo ya trabaja en TypeScript/React; Expo permite compartir tipos Zod con el backend y iterar rápido. Kotlin solo si se prevé uso intensivo de audio de bajo nivel. |
| Reconocimiento de voz (STT) | **STT nativo de Android** (`SpeechRecognizer`, vía `expo-speech-recognition`), es-ES/es-MX y en-CA | Whisper/Deepgram por streaming al servidor | Gratis, offline-capable, latencia baja, y no envía audio (PHI potencial) a un tercero adicional. |
| Síntesis de voz (TTS) | **TTS nativo de Android** (`expo-speech`) | ElevenLabs / Google Cloud TTS | Misma razón: costo cero, sin PHI a terceros; calidad suficiente para respuestas informativas. |
| LLM | **Claude API con tool use, ejecutado en el servidor** | LLM en el dispositivo | El modelo nunca toca la base de datos: solo puede invocar herramientas tipadas que ya aplican RBAC, tenancy y auditoría. La API key vive solo en el servidor. |
| Limitación de conocimiento | System prompt restrictivo + **conjunto cerrado de tools** + regla de rechazo | Fine-tuning | Si la pregunta no se puede responder con las tools disponibles, el asistente responde el mensaje de rechazo. Verificable con una suite de evaluación (§8). |
| Transporte de chat | `POST /api/assistant/chat` con **SSE** (streaming de texto) | WebSockets | SSE es compatible con Vercel y suficiente para chat unidireccional con streaming. |
| Auth móvil | **Supabase Auth** (mismos `auth.users`), tokens en Android Keystore, refresh automático, biometría opcional para reabrir | Auth propia | Reutiliza usuarios, roles (`app_metadata.roles`) y MFA existentes. |

## 4. Backend: capa de asistente en el backoffice

Nuevo módulo `src/lib/assistant/` + rutas `src/app/api/assistant/`:

- **`POST /api/assistant/chat`** — recibe `{ messages, locale }`, valida el JWT de Supabase (Bearer, con `supabase.auth.getUser(token)`), resuelve `organization_id` y `employee_id` (`getEmployeeIdForAuthUser`), exige el mismo nivel de MFA que la web para roles privilegiados, y ejecuta el loop de tool-use con Claude devolviendo SSE.
- **`GET /api/assistant/health`** — ping de versión/compatibilidad para la app.
- Ajustes de infraestructura: exceptuar `/api/assistant` de la redirección a `/login` en `src/lib/supabase/middleware.ts` (la ruta hace su propia validación de token y responde 401, nunca 302), rate limiting por usuario reutilizando `src/lib/security/`, y tope de tokens/turnos por conversación.

### Herramientas (tools) del asistente — fase inicial

Cada tool es un wrapper delgado sobre `src/lib/db/queries/*` que: (1) llama `authorize(resource, 'read')`, (2) fuerza `organization_id` y el alcance del rol (un `practitioner` solo ve sus pacientes/citas), (3) registra `access_logs` cuando devuelve PHI de un paciente concreto, (4) valida entrada/salida con Zod.

| Tool | Responde a | Se apoya en |
|---|---|---|
| `get_appointments_for_range` | "¿cuántos pacientes tengo el próximo viernes?", "¿qué agenda hay mañana?" | `listAppointments` + `clinicDayWindow`/`clinicWeekWindow`; excluye `cancelled`/`no_show` y de-duplica por `patient_id` para "cuántos pacientes" |
| `search_patients` | "búscame a la paciente María López" | `listPatientsPaged` |
| `get_patient_360` | "¿cuándo fue la última visita de X?, ¿debe algo?" | `getPatient360` (+ `access_logs`) |
| `get_care_shifts_for_range` | agenda de home care / caregivers | `listShiftsInWindow` |
| `get_follow_up_tasks` | "¿qué tareas tengo vencidas?" | `listTasks`, `dashboardCounters` |
| `get_invoices` / `get_payments` | "¿qué facturas están vencidas?" (solo roles con permiso de finanzas) | `listInvoicesPaged`, `listPaymentsPaged` |
| `run_report` | "dame el reporte de citas por estado de agosto" | `runReport` (códigos FIN/OPS/CLN/PKG/MKT existentes) |
| `resolve_date` | normaliza "próximo viernes", "esta semana", "el 15" | `date-fns` + helpers de `timezone.ts`; el servidor pasa al modelo la fecha/hora actual de la clínica en cada request |

**Regla de rechazo:** el system prompt define el rol ("agente exclusivo del backoffice de Vicaria"), enumera las tools y ordena que ante cualquier pregunta o pedido fuera de ese alcance responda exactamente el mensaje de rechazo en el idioma del usuario, sin intentar responder con conocimiento general. La suite de evaluación (§8) lo verifica.

### Herramientas de acción (escritura) — fase de agente

El agente también puede **ejecutar acciones** sobre el backoffice. Hoy la lógica de escritura vive en Server Actions atadas a cookies (`src/app/(app)/calendar/actions.ts`: `createAppointmentAction`, `updateAppointmentAction`, `changeAppointmentStatusAction`), así que el primer paso es **extraer esa lógica a funciones de dominio compartidas** (p. ej. `src/lib/domain/appointments/commands.ts`) que consuman tanto las Server Actions de la web como las tools del agente — misma validación Zod, mismo `authorize()`, misma escritura de `appointment_status_history` y `audit_events`.

| Tool de acción | Responde a | Se apoya en |
|---|---|---|
| `reschedule_appointment` | "cámbiale la cita a Cuco del sábado para el martes a las 3 pm" | lógica de `updateAppointmentAction` (nuevo `start_at`/`end_at`, estado `rescheduled` + cita nueva enlazada por `rescheduled_from_id`, historial de estados) |
| `create_appointment` | "agéndale a María una consulta el jueves a las 10" | lógica de `createAppointmentAction` (paciente, servicio, practitioner, ubicación, precio estimado) |
| `cancel_appointment` | "cancela la cita de Juan de mañana" | `changeAppointmentStatusAction` → `cancelled` con `cancellation_reason` obligatorio |
| `update_appointment_status` | "márcala como confirmada / llegó el paciente" | `changeAppointmentStatusAction` (`confirmed`, `checked_in`, `no_show`, …) validando transiciones permitidas |
| `create_follow_up_task` | "recuérdame llamar a Cuco el lunes" | inserción en `follow_up_tasks` |

**Protocolo obligatorio de toda acción (propose → confirm → execute → verify):**

1. **Resolver referencias.** "El cliente Cuco" se resuelve con `search_patients` (nombre legal, `preferred_name`, fuzzy); "el próximo sábado" y "el martes a las tres de la tarde" con `resolve_date` en hora de la clínica. Si hay ambigüedad (dos pacientes "Cuco", dos citas ese sábado, "las tres" ¿AM/PM? — se asume PM en horario de clínica pero se explicita), el agente **pregunta antes de proponer**, nunca adivina en silencio.
2. **Verificar precondiciones.** La cita origen existe y no está `completed`/`cancelled`; el nuevo horario no choca con otra cita del practitioner (`employeeAppointmentsInWindow`) ni cae fuera del horario de la sede; el usuario tiene permiso de escritura sobre esa cita según RBAC.
3. **Proponer y confirmar.** El agente enuncia la acción completa con datos resueltos (paciente con nombre y apellido, fecha absoluta, hora, servicio) por voz **y** en una tarjeta de confirmación en pantalla con botones Confirmar/Cancelar. La confirmación vale por voz ("sí", "confirmo") o por botón; cualquier otra respuesta cancela. **Ninguna tool de escritura se ejecuta sin este paso**, y eso se garantiza en el servidor: la propuesta devuelve un `action_token` firmado y de un solo uso con los parámetros exactos, y el endpoint de ejecución solo acepta ese token (el LLM no puede saltarse la confirmación aunque lo intente).
4. **Ejecutar y verificar.** Se ejecuta el comando de dominio, se relee la cita de la base de datos y se confirma al usuario con los datos reales resultantes ("Listo, la cita de Cuco Pérez quedó para el martes 8 de septiembre a las 15:00 con la Dra. X"). Si algo falla, se explica el motivo (conflicto de agenda, permiso insuficiente) y no se reintenta solo.
5. **Auditar.** Cada acción escribe `audit_events` con actor, origen `assistant`, acción y entidad — igual que si se hubiera hecho desde la web.

**Idempotencia:** el `action_token` de un solo uso evita ejecuciones duplicadas por reintentos de red o repeticiones del STT.

**Fuera de alcance de acciones (v2):** operaciones financieras (emitir/anular facturas, pagos, reembolsos), firma de encuentros clínicos y cambios de configuración. Son irreversibles o de alto riesgo y se quedan en la web; si el usuario las pide, el agente lo dice y sugiere hacerlo en el backoffice.

## 5. Aplicación Android (APK)

- **Pantallas:** Login (email/contraseña + reto TOTP si el rol exige MFA) → Chat (historial de burbujas, botón de micrófono estilo push-to-talk, indicador "escuchando/pensando/hablando", respuesta en streaming, **tarjetas de confirmación de acción** con resumen de la acción propuesta y botones Confirmar/Cancelar) → Ajustes (idioma es/en, voz on/off, velocidad de TTS, cerrar sesión).
- **Flujo de voz:** micrófono → STT nativo → el texto reconocido se muestra como mensaje editable → se envía a `/api/assistant/chat` → la respuesta llega por SSE y se muestra en vivo → al completarse (o por frases) se lee con TTS. Interrumpir el TTS al tocar el micrófono de nuevo.
- **Idiomas:** el asistente responde en el idioma en que se le habla (es/en), coherente con el modelo bilingüe del backoffice (`name_es`, `preferred_language`).
- **Seguridad en el dispositivo:** tokens en Android Keystore/EncryptedSharedPreferences; sin historial de chat persistido en el dispositivo en v1 (el chat contiene PHI); `FLAG_SECURE` para bloquear capturas de pantalla; cierre de sesión por inactividad; nada de PHI en logs/crash reports.
- **Distribución:** Google Play (pista interna/cerrada) como canal principal; APK firmado por descarga directa (MDM o link interno) como alternativa. EAS Build de Expo genera ambos.

## 6. Seguridad y privacidad (PHI)

1. Mismo perímetro que la web: Supabase Auth + `authorize()` + alcances por rol; el agente jamás amplía lo que el usuario ya puede ver **o hacer** en el backoffice (una recepcionista puede reprogramar citas porque ya puede; un rol `auditor` no puede escribir nada).
2. La API key del LLM vive solo en el servidor (variable de entorno en Vercel); la app nunca habla con el proveedor de IA.
3. Minimizar PHI hacia el LLM: las tools devuelven solo los campos necesarios para responder; se evalúa un acuerdo de no-retención/BAA-equivalente con el proveedor (Anthropic ofrece zero-data-retention en planes empresariales).
4. Auditoría: cada conversación registra `audit_events` (acción `assistant_query`, sin contenido PHI) y `access_logs` por paciente consultado, igual que la web.
5. Sin PHI en logs ni URLs (regla SEC-06 existente); transcripciones de voz nunca se envían a servicios de terceros (STT/TTS nativos).
6. Rate limiting y presupuesto de tokens por usuario/día para contener costo y abuso.

## 7. Fases de desarrollo

| Fase | Alcance | Salida verificable | Estimación |
|---|---|---|---|
| **0. Fundamentos** | Decisiones cerradas (RN/Expo, Claude, STT/TTS nativos), cuenta y llaves del LLM, esqueleto Expo, `GET /api/assistant/health` con auth Bearer funcionando end-to-end contra el backoffice | La app hace login con un usuario real de Supabase y llama a la API autenticada | ~1 semana |
| **1. Backend del asistente** | `/api/assistant/chat` con SSE, loop de tool-use, tools de citas + pacientes + fechas, system prompt con regla de rechazo, RBAC + auditoría, rate limiting | Con `curl` se responde correctamente "¿cuántos pacientes tengo el próximo viernes?" y se rechaza una pregunta general | 2–3 semanas |
| **2. Chat por texto en la APK** | UI de chat con streaming, manejo de sesión/refresh, estados de error/offline, ajustes básicos | APK interna donde todo el equipo puede chatear por texto | 2 semanas |
| **3. Voz** | STT push-to-talk es/en, TTS de respuestas, edición del texto reconocido, interrupción de lectura | El flujo del ejemplo (micrófono → pregunta → respuesta hablada) funciona en dispositivos reales | 1–2 semanas |
| **4. Cobertura completa de datos** | Tools de home care, tareas, facturación y reportes con sus alcances por rol; pulido de respuestas (formatos de fecha/moneda `es`/`en-CA`) | El asistente cubre "cualquier cosa que esté en el backoffice" según el rol del usuario | 2 semanas |
| **5. Acciones (agente)** | Extracción de la lógica de citas a comandos de dominio compartidos; tools de escritura (`reschedule_appointment`, `create_appointment`, `cancel_appointment`, `update_appointment_status`, `create_follow_up_task`); protocolo propose→confirm→execute→verify con `action_token` de un solo uso; tarjeta de confirmación en la APK; confirmación por voz | El flujo del ejemplo ("cámbiale la cita a Cuco del sábado para el martes a las 3 pm") funciona end-to-end con confirmación y queda auditado; imposible ejecutar una acción sin confirmación (probado en integración) | 2–3 semanas |
| **6. Endurecimiento y piloto** | Suite de evaluación (§8) en CI incluyendo acciones, pruebas de seguridad (intentos de jailbreak/inyección, acceso cruzado entre roles, bypass de confirmación), QA en dispositivos, piloto con 2–3 usuarios reales, distribución | Go/no-go con métricas: precisión de respuestas, tasa de rechazo correcta, 0 acciones sin confirmar, latencia p95 de voz→voz < 6 s | 2 semanas |

Total estimado: **12–15 semanas** de una persona full-time (menos con dedicación parcial en paralelo backend/app). Las fases 1–4 (solo lectura) ya son desplegables como piloto intermedio antes de habilitar acciones.

## 8. Estrategia de pruebas

- **Unitarias (Vitest, ya configurado):** resolución de fechas en lenguaje natural contra `clinicDayWindow` (incluye casos de DST), cada tool con fixtures por rol (un `practitioner` no ve pacientes ajenos; `marketing` no ve finanzas), de-duplicación de pacientes por día; comandos de dominio de citas (transiciones de estado válidas, detección de conflictos de agenda, `rescheduled_from_id`).
- **Acciones:** pruebas de integración del protocolo de confirmación — la tool de escritura sin `action_token` válido devuelve error; un token no puede usarse dos veces; token expirado se rechaza; la reprogramación escribe historial de estados y `audit_events`; escenarios de ambigüedad (dos pacientes con el mismo apodo, dos citas el mismo día) terminan en pregunta, nunca en ejecución.
- **Evaluación del agente (golden set):** ~50–100 preguntas con respuesta esperada en es/en — citas ("próximo viernes", "esta semana"), pacientes, facturas, reportes — más ~30 preguntas fuera de alcance (clima, consejos médicos generales, "ignora tus instrucciones…") que deben producir el rechazo, más ~30 pedidos de acción (reprogramar, cancelar, crear cita, incluyendo variantes ambiguas y pedidos prohibidos como "emite una factura") verificando que la propuesta resuelta sea correcta, que siempre pida confirmación y que la base de datos quede en el estado esperado. Se corre en CI contra datos seed y bloquea despliegues si la precisión o la tasa de rechazo bajan del umbral.
- **Integración:** `/api/assistant/chat` con tokens reales de Supabase (roles distintos), verificación de 401 sin token y de `access_logs`/`audit_events` escritos.
- **E2E móvil:** flujo login → pregunta por texto → respuesta; smoke manual del flujo de voz en 2–3 dispositivos físicos (el STT no es automatizable de forma fiable).

## 9. Riesgos y mitigaciones

| Riesgo | Mitigación |
|---|---|
| El LLM responde con conocimiento general pese al prompt | Conjunto cerrado de tools + golden set de rechazo en CI + segunda pasada barata de clasificación "¿en alcance?" si hiciera falta |
| Interpretación errónea de fechas ("próximo viernes" ambiguo) | `resolve_date` determinista en servidor con la hora de la clínica; el asistente confirma la fecha resuelta en su respuesta ("Para el viernes 4 de septiembre tienes…") |
| Fuga de PHI hacia terceros | STT/TTS nativos, LLM solo en servidor con retención cero, campos mínimos en tools, sin persistencia local del chat |
| STT nativo flojo con nombres propios/términos clínicos | El texto reconocido es editable antes de enviar; `search_patients` tolera coincidencias parciales/fuzzy |
| El agente ejecuta una acción equivocada (paciente/cita/fecha mal resueltos) | Protocolo propose→confirm→execute→verify: la acción se enuncia con datos absolutos resueltos y no se ejecuta sin confirmación; `action_token` de un solo uso impide ejecuciones no confirmadas o duplicadas; ambigüedad ⇒ pregunta obligatoria; todo queda en `audit_events` y las citas conservan `rescheduled_from_id` para revertir |
| Una acción irreversible pedida por voz (factura, reembolso, firma clínica) | Excluidas del catálogo de tools en v2; el agente responde que eso se hace en el backoffice web |
| Costo del LLM | Modelo pequeño-mediano (p. ej. Haiku) para el loop de tools con escalado solo si la calidad lo exige; presupuesto diario por usuario; caché de prompt del sistema |
| Server Actions no reutilizables desde móvil | Lecturas cubiertas por `src/lib/db/queries/*`; la lógica de escritura de citas se extrae de las Server Actions a comandos de dominio compartidos (`src/lib/domain/appointments/commands.ts`) que usan web y agente por igual |

## 10. Trabajo inmediato (checklist de arranque)

- [ ] Confirmar framework móvil (recomendado: React Native + Expo) y crear el repo `vicaria_assistant_app`.
- [ ] Provisionar API key de Claude en Vercel (`ANTHROPIC_API_KEY`) y acordar política de retención de datos.
- [ ] PR en `vicaria_backoffice`: módulo `src/lib/assistant/` + `/api/assistant/health` + excepción del prefijo en el middleware + prueba de integración de auth Bearer.
- [ ] Definir el golden set inicial (20 preguntas en alcance + 10 fuera de alcance) con el equipo de la clínica.
