> Fuente: Vicaria_BackOffice_Especificacion_Funcional_Mejorada.docx (v1.0, agosto 2026).
> Extracción de texto para referencia del equipo; el .docx original es la fuente autorizada.

VICARIA HEALTH
Back-Office de Clínica y Caregiver
Especificación funcional mejorada
Versión 1.0 · Agosto 2026
# 1. Resumen ejecutivo
El borrador original define correctamente el núcleo del sistema: pacientes, practitioners, caregivers, citas, historia clínica, formularios, facturación y pagos. La principal mejora necesaria es convertir esos elementos en un modelo flexible que soporte los servicios actuales de Vicaria y el nuevo servicio de caregiver sin crear flujos paralelos difíciles de mantener.
La web actual de Vicaria muestra dos familias de servicios que ya requieren comportamientos diferentes: Health Coaching (sesiones individuales y paquetes) y Skin Treatments (consulta y procedimientos cobrados por lesión). El caregiver añade una tercera modalidad: visitas programadas por tiempo, con plan de cuidado, tareas, registro de entrada/salida y horas facturables. Por tanto, el sistema debe compartir un expediente único del cliente, pero permitir que cada modalidad tenga su propia forma de documentarse y cobrarse.
Decisión de diseño recomendada. Un solo registro de Cliente/Paciente + un solo calendario + un solo módulo de facturación. El tipo de servicio determina qué formulario, nota, tarea o regla de precio se aplica. Esto reduce duplicación y hace que agregar un nuevo servicio sea una configuración, no un nuevo desarrollo.
## 1.1 Qué agrega esta versión al borrador
Catálogo de servicios configurable con precio fijo, por unidad/lesión, por hora o por paquete.
Separación clara entre Cita, Atención/Visita realizada e Invoice.
Manejo de paquetes de Health Coaching y saldo de sesiones.
Flujo completo de caregiver: plan de cuidado, visitas recurrentes, asignación, tareas, clock-in/out, notas, incidentes y horas aprobadas.
Formularios versionados con reglas: una sola vez, por visita, por servicio o con fecha de vencimiento.
Expediente 360° del paciente/cliente, incluyendo representante autorizado y contactos de emergencia.
Permisos por rol, registro de auditoría y controles para información sensible.
Reportes operativos, financieros y de caregiver.
Una propuesta de navegación y pantallas enfocada en minimizar clics.
Fases de implementación para evitar construir funciones complejas antes de necesitarlas.
# 2. Principios de diseño
Principio
Aplicación práctica
Configurar antes que programar
Servicios, precios, duración, formularios obligatorios, métodos de pago y reglas básicas deben modificarse desde Settings sin cambiar código.
Una sola fuente de verdad
Los datos de contacto, historia, documentos, citas, visitas e invoices parten del mismo Cliente/Paciente.
Trabajo por excepción
El dashboard debe destacar pendientes: formularios faltantes, notas sin firmar, visitas sin cerrar, invoices pendientes y certificaciones por vencer.
Pocos estados, claros
No crear decenas de estados. Usar estados cortos y comprensibles para citas, visitas, invoices y documentos.
No pedir dos veces el mismo dato
La información del paciente se reutiliza en formularios, consulta, invoice y caregiver.
Permisos por necesidad
Cada usuario ve únicamente lo necesario para su función. Un caregiver no necesita acceso a toda la historia financiera o clínica.
Mobile first para caregiver
La pantalla de caregiver debe poder operarse desde teléfono con botones grandes, tareas claras y muy poca escritura.
Crecer por fases
Portal familiar, GPS obligatorio, payroll completo, claims de seguro y optimización de rutas quedan para fases posteriores salvo necesidad inmediata.
# 3. Modelo de servicios
Se recomienda evitar una lista rígida de “tipos de consulta”. Debe existir un Catálogo de Servicios administrable. Cada servicio pertenece a una familia y define cómo se agenda, documenta y factura.
Campo del servicio
Ejemplos / uso
Nombre
In-Person Consultation, Skin Tag Removal Small, Health Coaching 60 min, Caregiver Hour.
Familia
Clinic/Skin Treatment, Health Coaching, Caregiver.
Unidad de cobro
Fijo, por unidad/lesión, por hora, por sesión o incluido en paquete.
Precio y moneda
Precio base en CAD; posibilidad de cambiarlo sin alterar históricos.
Taxable
Sí/No y tasa aplicable configurada por administración.
Duración estándar
15, 30, 60 min, o duración libre para caregiver.
Rol que puede prestarlo
Practitioner, Caregiver o ambos cuando corresponda.
Formularios requeridos
Consentimiento, intake, screening, care assessment, etc.
Requiere nota
Sí/No; plantilla de nota asociada.
Activo
Permite retirar un servicio sin borrar históricos.
## 3.1 Servicios observados actualmente en Vicaria
La estructura debe soportar, como mínimo, los servicios publicados actualmente: Health Coaching en sesión individual y paquetes, y tratamientos de piel como skin tags, seborrheic keratosis, ruby points, milia, warts, xanthelasma y sebaceous hyperplasia. La web también publica consulta gratuita por WhatsApp, consulta presencial y precios por lesión. El sistema no debe depender de esta lista porque los servicios pueden cambiar.
# 4. Personas, usuarios y roles
Para simplificar el modelo, conviene separar “persona registrada” de “usuario que inicia sesión”. Un paciente o representante puede existir en el sistema sin tener credenciales. Esto evita obligar a crear cuentas innecesarias y permite agregar un portal más adelante.
Rol
Acceso recomendado
Notas
Administrator
Acceso completo a pacientes, agenda, servicios, documentos, facturación, equipo, reportes y configuración.
No aparece como candidato a practitioner/caregiver salvo que también posea ese rol.
Practitioner
Agenda asignada, pacientes relacionados con sus atenciones, formularios clínicos pertinentes, notas, servicios realizados.
Puede cerrar/finalizar una atención y firmar documentación. No modifica configuración global.
Caregiver
Solo sus visitas asignadas, información mínima necesaria del cliente, plan/tareas de cuidado, clock-in/out, nota e incidentes.
No debe ver información financiera ni notas clínicas no relevantes.
Client/Patient
Registro maestro; no requiere login en MVP.
Puede tener representante autorizado y contactos de emergencia.
Authorized Representative
Persona relacionada al cliente con tipo de relación, autoridad/consentimiento y canales de contacto.
No requiere login en MVP. Puede convertirse en usuario si se crea Family Portal.
Front Desk/Billing - opcional
Agenda, pacientes, invoices y pagos, pero sin notas sensibles.
Puede omitirse al inicio si los administradores cubren esta función.
## 4.1 Perfil del equipo
Datos personales y de contacto.
Roles asignados (un usuario puede tener varios).
Disponibilidad semanal y excepciones/ausencias.
Certificaciones, títulos y documentos adjuntos.
Fecha de emisión y vencimiento de certificaciones cuando aplique.
Servicios para los que está habilitado.
Estado Active/Inactive para conservar históricos.
# 5. Expediente 360° del Cliente/Paciente
La pantalla más importante del sistema debe ser el expediente del cliente. Desde una sola vista se debe entender quién es la persona, qué servicios recibe, qué falta completar y cuál es su situación financiera.
Sección
Contenido
Resumen
Nombre, fecha de nacimiento, teléfono, email, dirección, idioma preferido, alertas importantes, representante y próxima cita/visita.
Contactos
Representante autorizado, contacto de emergencia, relación, teléfono, email y notas de autorización.
Appointments / Visits
Próximas y pasadas; estado; profesional/caregiver asignado.
Clinical / Service History
Atenciones completadas con fecha, servicios, cantidades, nota y profesional.
Caregiver
Plan de cuidado activo, visitas, tareas, incidencias y horas.
Forms & Consents
Formularios pendientes/completados, versión, fecha, firma y vigencia.
Documents
Adjuntos relevantes, fotografías autorizadas, PDFs y archivos externos.
Billing
Invoices, pagos, saldo pendiente, paquetes adquiridos y créditos de sesiones.
Communication
Registro simple de recordatorios o comunicaciones importantes; sin intentar reemplazar un sistema de mensajería completo.
Importante. “Edad” no debe guardarse como dato fijo; debe calcularse a partir de la fecha de nacimiento. Esto evita información incorrecta con el paso del tiempo.
# 6. Formularios, consentimientos y documentos
El borrador indica correctamente que los formularios aún no están terminados. Por eso el sistema debe incluir un constructor/administrador de plantillas suficientemente flexible, pero no un “form builder” excesivamente complejo. Para el MVP basta con tipos de campos comunes y lógica simple.
Función
Requisito
Plantilla
Nombre, descripción, servicio relacionado, activo/inactivo y versión.
Frecuencia
Una sola vez; en cada visita; cuando cambia la versión; o volver a completar después de X meses.
Campos
Texto corto/largo, número, fecha, Sí/No, selección, checkbox, firma, archivo.
Prellenado
Datos demográficos del paciente reutilizados automáticamente.
Firma
Paciente/representante, practitioner/caregiver cuando aplique, fecha/hora y nombre.
Estado
Pending, Completed, Signed, Expired/Superseded.
Inmutabilidad
Una vez firmado, no editar el documento original. Crear enmienda o nueva versión.
PDF snapshot
Guardar una representación final legible para auditoría y entrega al paciente si se solicita.
Reglas
La cita/visita debe advertir si falta un formulario obligatorio antes de cerrarse.
## 6.1 Formularios esperados
General Intake / Patient Information.
Consentimiento informado por tipo de procedimiento.
Screening de aptitud para tratamiento de piel.
Health Coaching intake / objetivos / seguimiento.
Caregiver initial assessment y plan de cuidado.
Autorización del representante cuando corresponda.
Consentimiento para fotografías, si Vicaria decide usar fotos de seguimiento.
Incident / Safety report para caregiver.
# 7. Agenda y flujo de consultas/tratamientos
La agenda debe ser compartida por toda la organización, con vistas Día/Semana y filtros por practitioner, caregiver, ubicación y tipo de servicio. El usuario debe crear una cita en pocos pasos.
Estado de cita
Significado
Scheduled
Creada.
Confirmed
Confirmada con el cliente.
Arrived
Cliente presente.
In Progress
Atención iniciada.
Completed
Atención cerrada.
Cancelled
Cancelada.
No-show
El cliente no asistió.
## 7.1 Flujo recomendado
Buscar o crear Cliente/Paciente.
Elegir fecha/hora, practitioner y servicio principal.
El sistema muestra formularios pendientes y permite enviarlos/registrarlos.
Al llegar el paciente: marcar Arrived y abrir la Atención.
El practitioner registra servicios realmente realizados y cantidades. Ejemplo: 1 consulta + 5 lesiones simples + 1 compleja.
Completar nota y formularios necesarios; firmar/cerrar la Atención.
Generar invoice automáticamente a partir de los servicios realizados, no solamente de lo que se había reservado.
Registrar pago o dejar saldo pendiente; emitir receipt.
Regla clave. La cita representa lo planificado; la Atención representa lo que realmente ocurrió. La factura debe originarse en lo realmente realizado.
# 8. Historia de atención / Clinical & Service Record
En lugar de una sola nota acumulativa editable, cada atención debe crear un registro fechado e independiente dentro de la historia del paciente. Así se conserva una línea de tiempo confiable.
Campo
Contenido
Cliente/Paciente
Referencia al expediente maestro.
Fecha/hora
Inicio y fin de la atención.
Practitioner
Responsable principal y, si se necesita, asistentes.
Servicios realizados
Líneas con servicio, cantidad, precio aplicado y notas breves por línea si hace falta.
Nota
Plantilla narrativa, SOAP o una plantilla específica por servicio.
Formularios
Documentos completados como parte de la atención.
Adjuntos
Fotografías/archivos cuando estén autorizados.
Estado
Draft / Finalized.
Firma
Usuario, fecha y hora de finalización.
Correcciones
Después de finalizar, agregar addendum; no sobrescribir silenciosamente el original.
# 9. Health Coaching
Health Coaching comparte la agenda y el expediente, pero necesita dos funciones adicionales que ya se desprenden de la oferta comercial de Vicaria: paquetes de sesiones y seguimiento de progreso.
Compra de paquete: 3, 6, 12 sesiones u otros configurables.
Saldo de sesiones disponibles y fecha de expiración si aplica.
Al completar una sesión, consumir automáticamente una unidad del paquete seleccionado.
Permitir sesiones sueltas sin paquete.
Nota de coaching con objetivos, acuerdos/action plan y seguimiento en próxima sesión.
Vista rápida de objetivos activos y progreso sin convertir el sistema en una plataforma clínica compleja.
# 10. Módulo Caregiver
Caregiver debe sentirse como una extensión natural del mismo sistema, pero orientada a visitas en domicilio. La experiencia de plataformas de home care muestra que los elementos que más valor aportan son: scheduling, care plan, tareas de la visita, documentación en el punto de atención, verificación de la visita, facturación y visibilidad para el equipo administrativo.
## 10.1 Perfil y plan de cuidado del cliente
Elemento
Requisito mínimo
Care profile
Dirección del servicio, teléfonos, representante, contacto de emergencia, idioma, instrucciones de acceso y preferencias relevantes.
Risk / Safety alerts
Riesgos prácticos para la visita: movilidad, mascotas, acceso, caídas, instrucciones especiales, etc.
Care plan
Objetivos, servicios autorizados/contratados, frecuencia y tareas esperadas.
Tasks / ADLs
Lista seleccionable: companionship, meal prep, light housekeeping, mobility assistance, reminders, errands u otras definidas por Vicaria.
Schedule rules
Días, horas, duración, recurrencia, caregiver preferido y reemplazos permitidos.
Version history
Cuando el plan cambia, conservar fecha de vigencia y versión anterior.
## 10.2 Visita de caregiver
Visitas recurrentes generadas desde el care plan o creadas individualmente.
Asignación a un caregiver disponible y habilitado.
Vista móvil “Hoy” con cliente, horario, dirección, instrucciones y tareas.
Clock-in y clock-out. En MVP puede ser manual con timestamp del servidor; GPS puede activarse posteriormente si legal y operacionalmente se decide usarlo.
Checklist de tareas: Done / Not Done / Not Applicable con comentario cuando no se completan.
Nota de visita breve, enfocada en hechos y observaciones relevantes.
Botón “Report Incident” visible, con severidad, descripción y notificación a administración.
Cierre de visita y envío a revisión si las horas reales difieren de las programadas.
## 10.3 Estados de visita
Estado
Uso
Scheduled
Programada y asignada o pendiente de asignación.
Accepted - opcional
Caregiver confirma la visita.
In Progress
Clock-in realizado.
Completed
Clock-out y documentación completa.
Needs Review
Diferencia de horario, incidente o documento pendiente.
Cancelled
Cancelada.
Missed
No se realizó; requiere seguimiento administrativo.
## 10.4 Horas, billing y payroll
Para mantener el MVP simple, el sistema debe separar dos conceptos: horas facturables al cliente y horas aprobadas del caregiver. Pueden ser iguales, pero no deben asumirlo. El payroll completo puede integrarse después.
Tarifa de venta por hora o por bloque de servicio.
Regla de redondeo configurable, si Vicaria la utiliza.
Horas programadas vs. reales vs. aprobadas.
Aprobación por administrador cuando existe diferencia.
Generación de invoice por visita, semana, quincena o período según contrato.
Reporte/export de horas aprobadas para payroll; cálculo completo de payroll queda fuera del MVP salvo requerimiento específico.
# 11. Invoices, pagos y paquetes
La facturación debe ser suficientemente completa para la operación diaria, pero sin intentar convertirse en un sistema contable general.
Función
Comportamiento
Invoice
Número único, fecha, cliente, datos de Vicaria, líneas, subtotal, tax, total, saldo, estado.
Origen
Atención clínica, sesión de coaching, visita caregiver o creación manual autorizada.
Líneas
Servicio, cantidad/unidades, precio aplicado, descuento autorizado y tax.
Estados
Draft, Issued, Partially Paid, Paid, Void/Credit.
Pagos
Cash, e-Transfer, Credit, Debit y otros configurables.
Pago parcial
Permitido; mantener saldo.
Receipt
Generar recibo al registrar el pago.
Packages
Compra, saldo de sesiones, consumo, expiración y ajuste administrativo con auditoría.
Refund/Credit
Manejo controlado mediante credit/refund; no borrar el pago original.
Export
CSV/Excel por período para contabilidad si se requiere.
No recomendado en MVP. No implementar contabilidad completa (general ledger), conciliación bancaria avanzada ni insurance claim adjudication dentro del back-office. Es mejor exportar/integrar con la herramienta contable que use Vicaria.
# 12. Recordatorios y comunicación
Guardar canal preferido: teléfono, SMS, email o WhatsApp.
Recordatorio de cita/visita configurable (por ejemplo, 24 h antes).
Recordatorio de formulario pendiente antes de la cita.
Plantillas simples para confirmación, cancelación y follow-up.
Registrar que una comunicación fue enviada, sin almacenar conversaciones completas de WhatsApp en el MVP.
Integración directa con WhatsApp Business, SMS o email puede añadirse después si el volumen lo justifica.
# 13. Dashboard y experiencia de usuario
El sistema debe abrir en una pantalla distinta según el rol. El objetivo es que cada persona vea primero lo que debe hacer hoy, no todos los datos disponibles.
Rol
Dashboard recomendado
Administrator
Agenda de hoy, clientes nuevos, appointments sin confirmar, formularios pendientes, invoices por cobrar, visitas caregiver sin asignar/Needs Review, alertas de certificaciones e incidentes.
Practitioner
Mis citas de hoy, formularios pendientes de mis pacientes, atenciones en Draft y próximos follow-ups.
Caregiver
Mis visitas de hoy y mañana, estado de cada visita, acceso directo a Start Visit / Complete Visit y alertas de cambios.
## 13.1 Menú recomendado
Menú principal
Contenido
Dashboard
Pendientes y métricas resumidas.
Calendar
Citas y caregiver visits; filtros por persona/servicio.
Clients
Búsqueda y expediente 360°.
Caregiver
Care plans, visitas, asignaciones y revisión de horas.
Billing
Invoices, pagos, paquetes y saldos.
Team
Practitioners, caregivers, disponibilidad y certificaciones.
Reports
Reportes operativos y financieros.
Settings
Servicios, precios, formularios, métodos de pago, clínica y reglas.
Regla de usabilidad. Las tareas frecuentes deben poder completarse desde la misma pantalla o con un máximo aproximado de 2-3 transiciones: crear cita, abrir atención, cobrar; o abrir visita, clock-in, completar tareas, clock-out.
# 14. Reportes esenciales
Reporte
Qué debe responder
Daily Schedule
¿Qué servicios y visitas hay hoy, quién los atiende y cuál es su estado?
Sales by Service
¿Cuánto se vendió por tratamiento, coaching y caregiver?
Payments by Method
¿Cuánto entró por cash, e-transfer, credit/debit, etc.?
Accounts Receivable
¿Qué invoices siguen pendientes y desde cuándo?
Practitioner Activity
Número de atenciones, servicios y revenue asociado.
Caregiver Hours
Horas programadas, reales, aprobadas y billables por caregiver/cliente.
Caregiver Exceptions
Missed visits, Needs Review, incidentes y tardanzas si se miden.
Package Balances
Paquetes activos, sesiones restantes y próximos a expirar.
No-show / Cancellation
Frecuencia y tendencia.
Certification Expiry
Documentos del equipo que vencen en 30/60/90 días.
Client Source - opcional
Cómo llegaron los clientes: Google, referral, WhatsApp, etc., útil para marketing.
# 15. Privacidad, seguridad y trazabilidad
Vicaria manejará información personal y potencialmente información de salud. La aplicabilidad concreta de PHIPA y de normas específicas de home care debe confirmarse con asesoría legal según la naturaleza exacta de los servicios y la estructura de la organización. Independientemente de esa clasificación, el diseño debe adoptar controles equivalentes a los esperados en sistemas de salud para reducir riesgo y facilitar cumplimiento futuro.
Role-Based Access Control (RBAC) y principio de mínimo acceso.
Autenticación fuerte; MFA al menos para administradores y usuarios con acceso sensible.
Audit log de accesos y cambios importantes: usuario, fecha/hora, registro afectado y acción.
No borrar silenciosamente notas finalizadas, invoices emitidos, pagos o consentimientos firmados.
Cifrado TLS en tránsito y cifrado de base de datos/backups en reposo.
Backups automáticos, pruebas de restauración y política de retención definida.
Timeout de sesión y protección ante intentos repetidos de login.
Capacidad de exportar el expediente de un cliente para solicitudes de acceso y de registrar correcciones/addenda.
Registro y procedimiento para incidentes de privacidad.
Separar ambientes Development/Test/Production y evitar datos reales de pacientes en desarrollo.
Referencia regulatoria. El IPC de Ontario recomienda controles de acceso por necesidad, políticas de privacidad y auditoría/monitoreo de accesos electrónicos. PHIPA exige medidas razonables para proteger información de salud contra pérdida, acceso, uso o divulgación no autorizados. Estas prácticas deben considerarse requisitos de diseño, aunque la clasificación legal específica de Vicaria se valide por separado.
# 16. Modelo de datos simplificado
Las entidades siguientes cubren el alcance sin crear un modelo innecesariamente complejo:
Entidad
Relaciones principales
Person
Base común para identidad/contacto. Puede representar client, staff o representative.
User Account
Se enlaza a Person y tiene uno o varios Roles.
Client Profile
Se enlaza a Person; contiene datos propios del cliente/paciente.
Representative / Contact
Relación entre Client y otra Person, con tipo y autorización.
Service
Catálogo configurable con familia, unidad, precio, duración y reglas.
Appointment
Planificación: client + fecha + staff + servicio previsto + estado.
Encounter
Atención realmente realizada; contiene líneas de servicios, notas y formularios.
Care Plan
Plan de caregiver vigente y versionado.
Care Visit
Visita de caregiver con schedule, clock-in/out, tareas y notas.
Form Template / Form Submission
Plantilla versionada y respuesta asociada al cliente/encounter/visit.
Package / Client Package
Definición del paquete y compra/saldo de sesiones del cliente.
Invoice / Invoice Line
Cobro generado desde encounter, care visit, paquete o manual.
Payment
Pago aplicado a uno o más invoices según el diseño final.
Document
Adjuntos con tipo, fecha, propietario y permisos.
Audit Event
Registro de acciones sensibles y cambios.
# 17. Reglas de negocio críticas
Un servicio desactivado no desaparece de registros históricos.
Cambiar un precio no modifica invoices o atenciones históricas; el precio aplicado queda guardado en la línea.
Un Appointment puede cancelarse sin borrar el historial de la cita.
Solo una Atención/Visita finalizada genera automáticamente billing, salvo excepción administrativa.
Las notas finalizadas y consentimientos firmados se corrigen mediante addendum/nueva versión.
Un usuario Administrator solo aparece en selección de practitioner/caregiver si también tiene ese rol.
El caregiver ve únicamente clientes/visitas dentro de su asignación y ventana operativa definida.
Un formulario obligatorio faltante genera advertencia; el sistema puede bloquear el cierre solo en formularios que Administración marque como “Blocking”.
Las cantidades deben permitir servicios por unidad, por ejemplo 5 lesiones simples y 1 compleja.
Los paquetes consumen unidades únicamente al completar la sesión, no al reservarla.
Una visita caregiver con diferencia relevante entre horario programado y real pasa a Needs Review antes de facturación/aprobación.
Todo ajuste manual de saldo de paquete, pago, horas o invoice debe registrar usuario, motivo y fecha.
# 18. Alcance recomendado por fases
Fase
Incluye
No incluye todavía
MVP / Fase 1
Clientes, roles, catálogo de servicios, calendar, appointments, encounters, formularios básicos, historia, caregiver care plan + visits + tasks + clock-in/out, invoices, pagos, paquetes, reportes básicos, auditoría.
Portal de paciente/familia, claims, payroll completo, rutas automáticas, GPS obligatorio, integraciones complejas.
Fase 2
Formularios online, firmas remotas, recordatorios automáticos, portal simple, integración de pagos, mejoras de caregiver, export payroll, dashboard avanzado.
Optimización de rutas con IA o integraciones enterprise si no hay necesidad.
Fase 3
Integraciones contables, WhatsApp Business/SMS, payroll o proveedor externo, analítica avanzada, GPS/geofencing si corresponde, APIs y automatizaciones.
Solo desarrollar según volumen y retorno esperado.
# 19. Funciones que recomiendo NO construir al inicio
Expediente médico hospitalario completo con diagnósticos codificados, prescripción y farmacia.
Insurance claim adjudication complejo.
Sistema contable completo.
Payroll completo con impuestos y remesas si puede exportarse a un proveedor existente.
Chat interno sofisticado o réplica de WhatsApp.
Optimización automática de rutas/caregiver matching con IA antes de tener volumen que la justifique.
Portal familiar con acceso amplio a records en la primera versión.
Constructor de formularios con lógica condicional arbitraria tipo enterprise; comenzar con campos y reglas simples.
Por qué. La mayoría de estas funciones agregan costo, riesgo y entrenamiento. El sistema debe resolver primero la operación diaria de Vicaria; después se añaden automatizaciones donde exista un problema real y medible.
# 20. Criterios de éxito del MVP
Un administrador puede crear un paciente, agendarlo, completar la atención y cobrarlo sin reingresar datos.
Un practitioner puede ver solamente sus actividades y completar documentación desde el expediente del paciente.
Un mismo appointment puede terminar con múltiples servicios y cantidades reales distintas a lo reservado.
Los formularios requeridos aparecen automáticamente según el servicio y conservan firma/versión.
Los paquetes de coaching muestran claramente sesiones compradas, usadas y restantes.
Un administrador puede crear un care plan recurrente y asignar visitas a caregivers.
Un caregiver puede completar una visita desde teléfono: abrir visita, clock-in, tareas, nota, incidente si aplica y clock-out.
Las horas completadas pueden revisarse y convertirse en billing sin transcripción manual.
El sistema muestra invoices pendientes, pagos por método y ventas por servicio.
Todos los cambios sensibles quedan trazables y los permisos impiden accesos no necesarios.
# 21. Flujos resumidos
## 21.1 Skin Treatment
Call/WhatsApp → Client → Appointment → Required forms → Arrived → Encounter → Services + quantities → Note → Finalize → Invoice → Payment → Receipt / Follow-up.
## 21.2 Health Coaching
Client → Package or single session → Appointment → Intake if needed → Coaching session → Goals/action plan → Finalize → Consume package session or Invoice → Next session.
## 21.3 Caregiver
Client intake → Care assessment → Care plan → Recurring schedule → Assign caregiver → Visit → Clock-in → Tasks + note → Incident if required → Clock-out → Review exception → Approve hours → Invoice / payroll export.
# 22. Recomendación final de producto
La mejor solución para Vicaria no es copiar un EMR grande ni un software enterprise de home care. Debe tomar de esos sistemas las ideas que reducen trabajo administrativo: expediente único, agenda central, documentación ligada a la visita, formularios reutilizables, facturación derivada del servicio real, care plans, tareas de caregiver, verificación de horas y permisos fuertes.
El MVP debe sentirse como un back-office pequeño y coherente. Si una función no ayuda a responder “qué tengo que hacer hoy”, “qué se hizo al cliente”, “qué falta documentar” o “qué debo cobrar/pagar”, probablemente puede esperar a una fase posterior.
Arquitectura funcional recomendada. Dashboard + Calendar + Clients + Caregiver + Billing + Team + Reports + Settings. Todo conectado por el mismo registro de Cliente/Paciente.
# 23. Fuentes y referencias utilizadas
Esta especificación se elaboró revisando la operación publicada de Vicaria y patrones de productos de gestión clínica y home care. Las referencias se utilizan como benchmark funcional; no implican que Vicaria deba copiar todos sus módulos.
1. Vicaria Health - Home / servicios actuales: https://vicaria.ca/
2. Vicaria Health - Services: https://vicaria.ca/service
3. Vicaria Health - Pricing: https://vicaria.ca/pricing
4. Jane - Clinical Documentation: https://jane.app/features/clinical-documentation
5. Cliniko - Features: https://www.cliniko.com/features/
6. AlayaCare Canada - Scheduling / Visit Management: https://alayacare.com/ca/visit-management/
7. AlayaCare Canada - Care Planning: https://alayacare.com/ca/care-planning/
8. AlayaCare Canada - Caregiver Mobile App: https://alayacare.com/ca/home-care-mobile-app/
9. AlayaCare Canada - Family Portal: https://alayacare.com/ca/family-portal/
10. Axxess - Non-Medical Care: https://www.axxess.com/home-care-software/non-medical-care
11. Information and Privacy Commissioner of Ontario - Unauthorized Access: https://www.ipc.on.ca/en/health-organizations/unauthorized-access
12. IPC Ontario - Access and Correction: https://www.ipc.on.ca/en/health-organizations/access-and-correction
13. Ontario e-Laws - Personal Health Information Protection Act, 2004: https://www.ontario.ca/laws/statute/04p03
14. Ontario e-Laws - O. Reg. 187/22 Home and Community Care Services: https://www.ontario.ca/laws/regulation/r22187
# Apéndice A. Correspondencia con el borrador original
Requisito original
Cómo queda mejorado
Servicios no estáticos
Catálogo configurable con familias, precio/unidad, duración, roles y formularios.
Historia clínica por paciente
Timeline de Encounter/Care Visit finalizados, inmutables y con addenda.
Consulta con cantidades
Encounter Lines soporta múltiples servicios y cantidades.
Usuarios con varios roles
User Account + Roles, con filtros por rol efectivo.
Datos legales y representante
Client 360 + Representative/Contact con relación y autorización.
Practitioner con títulos
Team profile + certifications + expiración + servicios habilitados.
Formularios futuros
Templates versionados y reglas de frecuencia/obligatoriedad.
Appointment → consulta → invoice
Se mantiene, separando Appointment, Encounter e Invoice para trazabilidad.
Pago y método
Payment records con métodos configurables, pagos parciales, receipt y refund/credit.
Nuevo Caregiver
Care Plan + recurring visits + caregiver assignment + tasks + clock-in/out + review + billing hours.