# AHP+: gestión y uso cotidiano

AHP+ convierte el estado operativo de un proyecto en archivos tipados,
verificables y transportables por Git. No reemplaza el trabajo del equipo ni
decide qué acciones externas están autorizadas.

## Pulso de inicio

Al abrir un proyecto o cambiar de plataforma:

```bash
npx ahp root .
npx ahp doctor .
npx ahp verify . --strict
npx ahp status .
npx ahp ready . --platform tu-plataforma
npx ahp context . --format markdown --budget 8000
```

Lee además `.ahp/manifest.json`, `.ahp/state/project.json` y `.ahp/INDEX.md`.
El contexto generado en vivo prevalece sobre un `INDEX.md` persistido que haya
quedado antiguo.

## Qué se guarda

| Elemento | Úsalo para | No lo uses para |
|---|---|---|
| Estado del proyecto | fase, objetivo, siguiente acción y bloqueos estables | narrar cada paso del chat |
| Evidencia | comandos, artefactos o URLs cuyo resultado fue observado | copiar secretos o afirmar acciones no ejecutadas |
| QA | aceptar o rechazar un gate usando evidencia identificable | sustituir pruebas reales por una opinión del modelo |
| Decisión | conservar una decisión y su autoridad | reescribir una decisión aceptada sin supersederla |
| Riesgo | mantener visible un riesgo activo | ocultar problemas para obtener un PASS |
| Checkpoint | recuperar una sesión desde un punto concreto | reemplazar commits o backups |
| Handoff | transferir continuidad a otra plataforma | conceder permiso para publicar, desplegar o fusionar |
| Evento de continuidad | conservar una frontera operativa y su fingerprint causal | copiar todo el chat o afirmar entrega remota |
| Lock | anunciar una zona de trabajo concurrente | bloquear archivos a nivel de sistema operativo |

## Flujo de una sesión

1. Ejecuta el pulso de inicio.
2. Comprueba rama, commit, árbol y `state_revision`.
3. Trabaja dentro de la autorización recibida.
4. Registra evidencia solo cuando exista una salida reproducible.
5. Crea un checkpoint al alcanzar un límite recuperable.
6. Regenera el brief cuando el contexto durable cambie.
7. Verifica estrictamente antes de entregar.

Ejemplo de evidencia:

```bash
npx ahp record evidence . \
  --title "Validación local" \
  --type test \
  --locator "npm test" \
  --result "PASS: 18 pruebas" \
  --confidence VERIFIED \
  --exit-code 0
```

El resultado debe describir lo observado. Si la prueba tuvo limitaciones,
decláralas mediante `--limitations`.

## Continuidad entre plataformas

En la plataforma emisora:

```bash
npx ahp checkpoint . \
  --session feature-x \
  --platform codex \
  --actor "Codex" \
  --summary "Límite validado" \
  --next-action "Recibir y continuar"

npx ahp handoff create . \
  --from codex \
  --to cursor \
  --session feature-x \
  --summary "Continuar desde el límite validado"
```

El handoff nuevo debe confirmarse y enviarse mediante Git con autorización
explícita. En el receptor:

```bash
npx ahp verify . --strict
npx ahp handoff inspect HOF-... .
npx ahp handoff receive HOF-... .
npx ahp sync check . --require-remote
```

`READY` significa que la identidad, integridad y relación Git son compatibles.
No significa que el receptor tenga permiso para hacer commit, push, merge,
deploy o publicación.

## Portabilidad

| Estado | Interpretación operativa |
|---|---|
| `LOCAL_ONLY` | Hay cambios de proyecto que no existen en el remoto. No hagas handoff como si fueran transportables. |
| `PUSH_REQUIRED` | El estado AHP+ nuevo necesita commit y push autorizados. |
| `REMOTE_DIVERGED` | El remoto y la copia local requieren reconciliación humana. |
| `REMOTE_READY` | La copia está limpia y coincide con su upstream configurado. |

## Concurrencia

Antes de una escritura sensible, conserva los valores devueltos por `status`:

```bash
--expected-head <commit>
--expected-state <state_revision>
```

Si alguno cambió, AHP+ detiene la escritura. Vuelve a leer el contexto; no
fuerces el cambio. Usa locks para anunciar trabajo simultáneo sobre un scope,
pero recuerda que son avisos cooperativos.

## Actualizar AHP+

1. Revisa el changelog y el tag objetivo.
2. Asegura una copia limpia y recuperable.
3. Cambia la dependencia al tag exacto.
4. Ejecuta `doctor`, `verify --strict` y el gate propio del proyecto.
5. Revisa adaptadores en modo plan antes de aplicar.
6. Registra evidencia y confirma los cambios con autorización.

Nunca actualices automáticamente desde `main`.

## Copias, restauración y retiro

Git es el transporte y el historial principal. AHP+ no sustituye backups del
repositorio ni de servicios externos.

`npm uninstall @jossuealcala/ahp-plus` elimina la dependencia, pero no debe
considerarse una desinstalación completa: `.ahp/` y los adaptadores contienen
historial del proyecto. Antes de retirarlos, archiva o confirma el último estado,
revisa el diff y obtén autorización para eliminar cada ruta. AHP+ no ofrece un
comando de borrado automático.

## Privacidad y seguridad

- No guardes tokens, contraseñas, `.env`, datos personales ni contenido privado
  innecesario en registros.
- Usa referencias mínimas y reproducibles.
- La detección de secretos es heurística; no sustituye una revisión de seguridad.
- Un archivo AHP+ puede viajar con Git. Trátalo con la misma clasificación que
  el repositorio.

Consulta también [el contrato de comandos](COMMANDS.md) y
[continuidad móvil/remota](MOBILE_AND_REMOTE.md). Para saber qué escribir en
una terminal, IDE o app, usa [Comandos por superficie](COMMANDS_BY_SURFACE_ES.md).
