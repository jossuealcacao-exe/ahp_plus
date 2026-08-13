# Feedback y mejora pública de AHP+

AHP+ es público. Cualquier usuario puede instalar la versión estable, probar el
canal de desarrollo y reportar mejoras. No existe una cohorte cerrada ni
telemetría silenciosa.

## Dónde reportar

- Usa GitHub Issues para bugs reproducibles, compatibilidad y documentación.
- Usa el canal privado indicado en `SECURITY.md` para vulnerabilidades, secretos
  o posibles bypasses de autoridad.
- Una propuesta de cambio de protocolo debe explicar compatibilidad, migración
  y evidencia; no basta con cambiar el CLI.

## No publiques

- tokens, contraseñas, archivos `.env` o credenciales;
- repositorios, registros `.ahp/` o datos de clientes sin permiso;
- nombres o testimonios de terceros sin autorización;
- afirmaciones de ejecución sin una salida observada.

## Reporte reproducible

```text
Versión AHP+:
Canal: latest / versión exacta / next
Sistema operativo, shell y Node.js:
IDE o app:
Tipo de repositorio: público / privado (sin URL si no está autorizada)

Objetivo:
Comando o prompt exacto, sin secretos:
Resultado observado:
Resultado esperado:
¿Bloqueó el trabajo?: sí / no
Workaround:
Evidencia autorizada:
Limitaciones:
```

## Clasificación

- **Seguridad:** exposición, pérdida o bypass de autoridad.
- **Integridad:** estado alterado aceptado o identidad Git incorrecta.
- **Portabilidad:** estado confirmado no reproducible en el receptor.
- **Compatibilidad:** fallo de OS, shell, Node.js, IDE o app.
- **Usabilidad:** comportamiento correcto pero difícil de entender.
- **Documentación:** guía incompleta o ambigua.
- **Mejora:** capacidad nueva compatible con el objetivo del protocolo.

## Cómo se acepta una mejora

1. Separar observación de interpretación.
2. Reproducir sin datos privados.
3. Identificar si afecta protocolo, CLI, adaptador o documentación.
4. Añadir pruebas cuando cambie comportamiento.
5. Pasar tests, conformance, validación y empaquetado.
6. Publicar primero en `next` si el riesgo lo amerita.
7. Promover a estable únicamente con revisión y autorización.
