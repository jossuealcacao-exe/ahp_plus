# AHP+: instalación y primeros 15 minutos

Esta guía instala AHP+ dentro de un repositorio Git existente. AHP+ pertenece
al proyecto, no a una cuenta, chat, modelo o editor.

## Antes de instalar

Necesitas Git, Node.js 20 o superior, un repositorio Git con al menos un commit
y autoridad para modificarlo. Trabaja en una rama revisable y guarda o confirma
primero cualquier cambio ajeno. AHP+ no limpia el árbol, cambia de rama, hace
commit, push ni publica por su cuenta.

No necesitas que el proyecto use Node ni que ya tenga `package.json`. Si falta,
`setup` crea un manifiesto mínimo y privado dentro de ese repositorio para fijar
la CLI; así npm no puede resolver la dependencia en un directorio padre.

## Instalar y configurar

Desde la raíz del proyecto ejecuta un solo comando:

```bash
npx @jossuealcala/ahp-plus@1.4.0 setup .
```

El comando instala la versión exacta como dependencia de desarrollo, inicializa
o actualiza `.ahp/`, instala los adaptadores y MCP de Codex y Claude, crea las
identidades de dispositivo fuera de Git y ejecuta `doctor` más
`verify --strict`.

Si solo vas a usar un IDE, evita archivos de integración innecesarios:

```bash
npx @jossuealcala/ahp-plus@1.4.0 setup . --platforms codex
```

La primera salida debe indicar `status: AHP_READY` y ambos checks en `PASS`.
Repite el mismo comando para confirmar que `applied` queda vacío y los archivos
aparecen en `unchanged`: la operación es idempotente.

Antes de la publicación, prueba el tarball local exacto o ejecuta desde un
checkout revisado:

```bash
node bin/ahp.mjs setup /ruta/al/proyecto --no-install
```

## Primer pulso

La instalación ya deja `npx ahp` disponible en el proyecto. Comprueba el
contexto antes de pedir trabajo a un agente:

```bash
npx ahp project check .
npx ahp project status .
npx ahp session context . --format markdown --budget 8000
```

Confirma que `project_id`, raíz Git, rama y commit sean los del proyecto
correcto. En una instalación nueva, `LOCAL_ONLY` es normal hasta que la persona
revise, confirme y transporte los cambios deliberadamente.

## Primer uso en el IDE

Abre el mismo repositorio en Codex o Claude Code y reinicia el chat o la
aplicación si el host carga MCP al abrir el proyecto. Después pide en el chat:

```text
Usa AHP+ para comprobar este proyecto y mostrar project_id, commit,
portabilidad, bloqueos y siguiente acción. No edites archivos.
```

Para iniciar una conversación de proyecto entre Codex y Claude, pide desde
cualquiera de los chats que abra una sala compartida. Cada IDE lee y responde
desde su propia superficie MCP; AHP+ no inyecta texto automáticamente en la
caja nativa de otro IDE.

## Revisar y continuar

Revisa el diff antes de confirmar los archivos generados. Cuando la instalación
se haya confirmado en Git, acepta explícitamente la frontera canónica:

```bash
npx ahp project status .
npx ahp set-state . \
  --accept-head \
  --confidence USER_CONFIRMED \
  --next-action "Crear el primer checkpoint"
npx ahp project verify . --strict
```

El comando no hace commit ni push. Solo cuando los cambios revisados estén en
el remoto autorizado `sync check --require-remote` podrá reportar continuidad
transportable.

Continúa con [Gestión y uso cotidiano](OPERATIONS_ES.md) y consulta
[Comandos por superficie](COMMANDS_BY_SURFACE_ES.md) para Cursor, OpenCode,
Codex y Claude Code.
