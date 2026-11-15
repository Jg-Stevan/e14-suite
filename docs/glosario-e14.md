# Glosario E-14 (borrador v1 — validar términos con el equipo)

| Término | Significado en este proyecto |
|---|---|
| **E-14** | Formato oficial colombiano de escrutinio en mesa: el acta donde el jurado anota los votos por candidato/partido. Es el documento que las apps digitalizan. |
| **Acta** | La imagen/formulario del E-14 capturado. Objeto central del pipeline. |
| **Jurado de mesa** | Ciudadano que preside la mesa y diligencia el acta. Sus datos (nombre, cédula, firma) son sensibles: NUNCA deben entrar al repo ni a logs. |
| **DIVIPOLA** | División Político-Administrativa de Colombia: codificación oficial de departamentos, municipios y puestos. El panel la usa para validar que el acta pertenezca al puesto correcto (monitor DIVIPOLA). |
| **Puesto de votación** | Lugar físico donde votan los ciudadanos; contiene mesas. Identificado por código DIVIPOLA. |
| **Mesa** | Unidad de votación dentro de un puesto (999 puestos / 3.670 mesas en el universo de datos de la suite). |
| **idEnlace** | Identificador que enlaza la captura móvil del acta con su registro en el panel (trazabilidad de extremo a extremo de la cadena offline-first). |
| **Gate (puerta de calidad)** | Verificación automática antes de aceptar una captura: legibilidad, quad correcto, campos completos. Si el gate no pasa, el acta no sube. |
| **Modo SIM** | Modo de demostración que usa imágenes sintéticas (`sim-*.jpg`) en lugar de actas reales. Es el modo de las demos de presentación. |
| **Ingesta masiva** | Flujo del panel para digitalizar lotes grandes de imágenes de actas con dedup perceptual. |
| **Dedup perceptual** | Detección de imágenes duplicadas por similitud visual (hash perceptual), no byte a byte. |
| **Hub** | Punto de sincronización donde la cola firmada del móvil deposita las capturas y el panel las consume. |
| **Cascada OCR** | Secuencia de motores/estrategias de reconocimiento (Tesseract → RapidOCR → rescates) aplicada a los recortes del acta. |
