# Comandos de AHP+ por terminal, IDE y app

AHP+ tiene un solo contrato. Lo que cambia entre superficies es cómo solicitas
la operación: comando exacto en una terminal, comando semántico instalado por
un adaptador o prompt natural respaldado por las instrucciones del repositorio.

## Terminal: comandos exactos

Dentro de un proyecto que instaló AHP+ como dependencia local, usa `npx ahp`:

| Objetivo | Comando |
|---|---|
| Resolver la raíz | `npx ahp root .` |
| Diagnosticar instalación | `npx ahp doctor .` |
| Verificar estrictamente | `npx ahp verify . --strict` |
| Ver estado y portabilidad | `npx ahp status .` |
| Generar contexto acotado | `npx ahp context . --format markdown --budget 8000` |
| Comprobar sincronización | `npx ahp sync check . --require-remote` |
| Regenerar el brief | `npx ahp brief . --budget 8000` |
| Crear checkpoint | `npx ahp checkpoint . --summary "..." --next-action "..."` |
| Ver historial | `npx ahp history .` |
| Crear handoff | `npx ahp handoff create . --from codex --to cursor --summary "..."` |
| Inspeccionar handoff | `npx ahp handoff inspect HOF-... .` |
| Recibir handoff | `npx ahp handoff receive HOF-... .` |
| Planear adaptadores | `npx ahp adapter install all .` |
| Aplicar adaptadores | `npx ahp adapter install all . --apply` |

Los comandos que escriben aceptan `--expected-head <commit>` y
`--expected-state <revision>`. Usa ambos cuando exista trabajo concurrente.

## Vocabulario semántico común

En IDEs y apps puedes pedir estas operaciones sin copiar toda la sintaxis:

- `doctor`: diagnostica identidad, layout y portabilidad.
- `verify strict`: valida estructura, referencias, integridad y advertencias.
- `context`: resume el estado canónico con presupuesto de contexto.
- `checkpoint`: persiste un punto de recuperación con siguiente acción.
- `handoff to <plataforma>`: prepara continuidad sellada para otro host.
- `receive <HOF-ID>`: valida un handoff antes de continuar.
- `status` o `sync check`: comprueba Git y transporte remoto.
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
/ahp checkpoint resumen="Límite validado" siguiente="Crear handoff"
/ahp handoff to codex
/ahp receive HOF-...
```

El archivo del comando indica a Cursor que resuelva la raíz, lea
`AHP_INSTRUCTIONS.md` y ejecute el CLI cuando tenga terminal.

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
