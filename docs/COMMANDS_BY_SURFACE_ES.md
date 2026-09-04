# Comandos de AHP+ por terminal, IDE y app

AHP+ tiene un solo contrato. Lo que cambia entre superficies es cómo solicitas
la operación: comando exacto en una terminal, comando semántico instalado por
un adaptador o prompt natural respaldado por las instrucciones del repositorio.

## Terminal: comandos exactos

Dentro de un proyecto que instaló AHP+ como dependencia local, usa `npx ahp`:

| Objetivo | Comando |
|---|---|
| Instalar y configurar | `npx @jossuealcala/ahp-plus@1.4.0 setup .` |
| Instalar solo Codex | `npx @jossuealcala/ahp-plus@1.4.0 setup . --platforms codex` |
| Pulso completo recomendado | `npx ahp project check . --platform codex` |
| Resolver la raíz | `npx ahp project root .` |
| Diagnosticar instalación | `npx ahp project doctor .` |
| Diagnosticar Git del host | `npx ahp project doctor . --diagnose-git` |
| Verificar estrictamente | `npx ahp project verify . --strict` |
| Ver estado y portabilidad | `npx ahp project status .` |
| Separar readiness local/remoto | `npx ahp project ready . --platform codex` |
| Generar contexto acotado | `npx ahp session context . --format markdown --budget 8000` |
| Comprobar sincronización | `npx ahp sync check . --require-remote` |
| Regenerar el brief | `npx ahp session brief . --budget 8000` |
| Crear checkpoint | `npx ahp session checkpoint . --summary "..." --next-action "..."` |
| Ver historial | `npx ahp session history .` |
| Crear handoff | `npx ahp handoff create . --from codex --to cursor --summary "..."` |
| Enviar mensaje causal | `npx ahp message send "..." --from codex --to cursor` |
| Leer inbox del agente | `npx ahp message inbox . --for cursor` |
| Responder un mensaje | `npx ahp message reply EVT-... "..." --from cursor` |
| Verificar fingerprint | `npx ahp message verify EVT-... .` |
| Enviar por relay | `npx ahp relay send EVT-... . --channel /shared/ahp-relay` |
| Recibir del relay | `npx ahp relay receive . --as cursor --channel /shared/ahp-relay` |
| Esperar mensaje | `npx ahp relay wait . --as cursor --channel /shared/ahp-relay` |
| Importar recibos | `npx ahp relay confirm . --as codex --channel /shared/ahp-relay` |
| Verificar recibo | `npx ahp relay receipt verify RCP-... .` |
| Consultar Claude desde Codex | `npx ahp agent ask claude "..." --from codex` |
| Consultar Codex desde Claude | `npx ahp agent ask codex "..." --from claude` |
| Abrir sala compartida | `npx ahp conversation open "..." --participants codex,claude --from codex` |
| Enviar a la sala | `npx ahp conversation send conv-... "..." --from codex` |
| Leer inbox de sala | `npx ahp conversation inbox conv-... --for claude` |
| Esperar mensaje de sala | `npx ahp conversation wait conv-... --for codex --timeout 60` |
| Listar dispositivos | `npx ahp identity list` |
| Enviar cifrado por red | `npx ahp secure network send EVT-... --from-device DEV-... --to-device DEV-... --url URL --token-file FILE` |
| Recibir cifrado por red | `npx ahp secure network receive --as-device DEV-... --url URL --token-file FILE` |
| Confirmar recibo firmado | `npx ahp secure network confirm --as-device DEV-... --url URL --token-file FILE` |
| Inspeccionar handoff | `npx ahp handoff inspect HOF-... .` |
| Recibir handoff | `npx ahp handoff receive HOF-... .` |
| Planear adaptadores | `npx ahp adapter install all .` |
| Aplicar adaptadores | `npx ahp adapter install all . --apply` |

Los comandos que escriben aceptan `--expected-head <commit>` y
`--expected-state <revision>`. Usa ambos cuando exista trabajo concurrente.
La sintaxis anterior de AHP+ 1.2 sigue disponible como alias compatible.

No necesitas un `package.json` previo: `setup` crea un manifiesto mínimo y
privado cuando falta, para fijar AHP+ dentro del repositorio correcto.

## Vocabulario semántico común

En IDEs y apps puedes pedir estas operaciones sin copiar toda la sintaxis:

- `project check`: ejecuta el pulso recomendado completo.
- `project doctor`: diagnostica identidad, layout y portabilidad.
- `project verify strict`: valida estructura, referencias, integridad y advertencias.
- `session context`: resume el estado canónico con presupuesto de contexto.
- `session checkpoint`: persiste un punto de recuperación con siguiente acción.
- `handoff to <plataforma>`: prepara continuidad sellada para otro host.
- `receive <HOF-ID>`: valida un handoff antes de continuar.
- `status` o `sync check`: comprueba Git y transporte remoto.
- `ready`: separa continuidad local de transporte remoto.
- `message send`, `inbox`, `reply` y `verify`: operan mensajes seleccionados
  con fingerprints causales dentro del chat o la terminal.
- `relay send`, `receive`, `wait` y `confirm`: transportan el EVT autenticado y
  devuelven un RCP creado por el receptor sin cambiar el fingerprint original.
- `agent ask`: obtiene una sola opinión de solo lectura desde Codex o Claude y
  registra solicitud/respuesta con causalidad verificable.
- `conversation`: abre una sala durable de proyecto. Cada IDE lee y responde
  mediante su propio MCP; `wait` es long-poll explícito, no inyección automática
  en una caja nativa ni activación de un chat inactivo.
- `identity` y `secure network`: operan identidad por dispositivo, cifrado y
  recibos `SRC` firmados.
- `record evidence`: conserva el resultado observado de una prueba o artefacto.

El adaptador debe traducir esta intención al CLI instalado y mostrar resultados
reales. Un mensaje del modelo no sustituye la ejecución.

## Cursor

`npx ahp adapter install cursor . --apply` instala
`.cursor/commands/ahp.md`. En el chat de Cursor usa:

```text
/ahp doctor
/ahp verify strict
/ahp context
/ahp project check
/ahp session checkpoint resumen="Límite validado" siguiente="Crear handoff"
/ahp message send to=codex text="Continúa desde el límite verificado"
/ahp message inbox for=cursor
/ahp message reply EVT-... text="Recibido y verificado"
/ahp relay send EVT-... channel="/shared/ahp-relay"
/ahp relay wait as=cursor channel="/shared/ahp-relay"
/ahp relay confirm as=codex channel="/shared/ahp-relay"
/ahp handoff to codex
/ahp receive HOF-...
/ahp conversation open title="Revisión de arquitectura" participants="codex,claude"
/ahp conversation inbox room=conv-... for=cursor
```

El archivo del comando indica a Cursor que resuelva la raíz, lea
`AHP_INSTRUCTIONS.md` y ejecute el CLI cuando tenga terminal.

El relay de referencia requiere un secreto de proyecto de 32 bytes o más en
`AHP_RELAY_SECRET`. El secreto no se persiste. El HMAC acredita posesión de esa
credencial compartida, no identidad única del modelo o dispositivo; el canal de
archivos tampoco cifra el contenido.

## OpenCode

`npx ahp adapter install opencode . --apply` instala
`.opencode/commands/ahp.md`. Usa el mismo vocabulario:

```text
/ahp status
/ahp verify strict
/ahp handoff to claude
```

## Codex

`npx ahp adapter install codex . --apply` instala la skill local `ahp`. En un
chat de Codex puedes invocarla explícitamente:

```text
Usa $ahp para verificar este repositorio y mostrar el contexto canónico.
Usa $ahp para crear un checkpoint y preparar un handoff a Cursor.
Usa $ahp para recibir HOF-... y no edites si el outcome no es READY.
Usa $ahp para preguntarle a Claude qué riesgo ve en este cambio, solo lectura.
```

Codex también lee el bloque AHP+ de `AGENTS.md` instalado por el adaptador
genérico.

## Claude Code

`npx ahp adapter install claude . --apply` conecta `CLAUDE.md` con
`AHP_INSTRUCTIONS.md`. El adaptador actual no instala un slash command propio;
usa un prompt natural:

```text
Usa AHP+ para ejecutar doctor, verify --strict y context antes de continuar.
Prepara un checkpoint y un handoff de Claude a Codex, sin hacer commit ni push.
Recibe HOF-... con AHP+ y detente si requiere reconciliación.
Usa AHP+ para pedirle a Codex una revisión de solo lectura y una sola respuesta.
```

## ChatGPT y otras apps con repositorio y terminal

Si la app puede leer el repositorio y ejecutar comandos:

```text
Lee AHP_INSTRUCTIONS.md. Usa el AHP+ instalado para ejecutar el pulso de inicio
y muéstrame project_id, commit, portabilidad, bloqueos y siguiente acción.
```

Si la app solo puede leer archivos, debe usar `AHP_MOBILE.md`, `.ahp/INDEX.md`
y el handoff confirmado como cápsula de solo lectura. Debe declarar que no
ejecutó `verify`, tests, commits ni pushes.

## Agentes genéricos

El adaptador `generic` instala `AHP_INSTRUCTIONS.md` y un bloque administrado en
`AGENTS.md`. Pide:

```text
Sigue las instrucciones AHP+ de este repositorio. Verifica antes de escribir y
usa el estado Git confirmado como fuente canónica.
```

## Operaciones que siguen requiriendo autoridad

Ninguna forma de invocación autoriza `commit`, `push`, `pull`, cambio de rama,
merge, deploy, publicación, pagos, eliminación o acceso a secretos. La persona
debe autorizar esas acciones por separado.
