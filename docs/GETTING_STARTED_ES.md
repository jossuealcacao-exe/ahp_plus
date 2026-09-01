# AHP+: instalación y primeros 15 minutos

Esta guía instala AHP+ dentro de un repositorio Git existente. AHP+ pertenece
al proyecto, no a una cuenta, chat, modelo o editor.

## Antes de instalar

Necesitas:

- Git.
- Node.js 20 o superior.
- Un repositorio Git con al menos un commit.
- Autoridad para modificar el repositorio.
- Una rama de trabajo revisable; evita instalar directamente durante un
  despliegue o una corrección urgente.

Guarda o confirma primero cualquier cambio ajeno. AHP+ no limpia el árbol, no
cambia de rama y no publica nada por su cuenta.

## Elegir el canal oficial

Para uso normal instala el canal estable de npm:

```bash
npm install --save-dev @jossuealcala/ahp-plus@latest
```

Durante el desarrollo de 1.2, `latest` continúa siendo 1.1.0. Las pruebas de
1.2 deben usar un prerelease exacto o un checkout revisado; nunca `main` como
dependencia de producción.

Para un proyecto AHP+ 1.1 existente, revisa y aplica la migración de protocolo
sin reescribir checkpoints, records ni handoffs sellados:

```bash
npx ahp upgrade . --plan
npx ahp upgrade . --apply
```

Para fijar exactamente la primera versión estable:

```bash
npm install --save-dev @jossuealcala/ahp-plus@1.1.0
```

La misma versión está disponible en GitHub bajo el tag `v1.1.0`, junto con el
paquete descargable y su checksum. No uses `main` como versión. Si quieres
probar cambios futuros, usa el canal `next` descrito en [Canales de
distribución](CHANNELS_ES.md); no lo uses por accidente en producción.

## Inicializar el proyecto

Desde la raíz Git del proyecto:

```bash
npx ahp init . \
  --owner "Tu nombre" \
  --project mi-proyecto
```

El identificador de proyecto debe ser estable y describir el repositorio, por
ejemplo `mi-api` o `sitio-comercial`. La inicialización crea `.ahp/` y añade un
bloque administrado a `.gitignore`. No hace commit ni push.

Comprueba la identidad antes de continuar:

```bash
npx ahp root .
npx ahp doctor .
npx ahp verify . --strict
npx ahp status .
npx ahp ready . --platform tu-plataforma
```

Debes confirmar que `root`, `project_id`, rama y commit pertenecen al proyecto
correcto. En una instalación nueva, `LOCAL_ONLY` es normal: los archivos aún
no están confirmados en Git.

## Instalar adaptadores

Primero revisa el plan:

```bash
npx ahp adapter install all .
```

Si no hay colisiones inesperadas, aplica el plan:

```bash
npx ahp adapter install all . --apply
```

Los adaptadores conectan el mismo protocolo con `AGENTS.md`, Claude, Cursor,
OpenCode, Codex y una cápsula para ChatGPT/móvil. No crean protocolos distintos.
Una segunda ejecución debe ser idempotente: no debe volver a modificar archivos
que ya coinciden.

## Revisar y transportar la instalación

Revisa el diff completo. Confirma solamente los archivos de instalación que
entiendas y deja fuera cualquier cambio previo ajeno.

Después del commit de instalación, actualiza la frontera canónica:

```bash
npx ahp status .
npx ahp set-state . \
  --accept-head \
  --confidence USER_CONFIRMED \
  --next-action "Crear el primer checkpoint"
npx ahp verify . --strict
```

`set-state --accept-head` actualiza explícitamente `base_commit`; tampoco hace commit. El cambio de estado
debe confirmarse como un sobre AHP+ separado. Solo después de que ambos commits
estén en el remoto el proyecto podrá reportar `REMOTE_READY`.

## Primer checkpoint

```bash
npx ahp checkpoint . \
  --session onboarding \
  --platform tu-plataforma \
  --actor "Tu agente o tu nombre" \
  --summary "AHP+ instalado y verificado" \
  --next-action "Continuar con la primera tarea gobernada"
```

El checkpoint es un punto de recuperación, no una afirmación de que hubo
commit, push o despliegue. Registra solo hechos observados.

## Criterio de instalación terminada

- `doctor` devuelve `ok: true`.
- `verify --strict` devuelve `ok: true`.
- El `project_id` y la raíz Git son correctos.
- Los adaptadores fueron revisados y aplicados sin colisiones no resueltas.
- La instalación y el sobre de estado están confirmados y disponibles en el
  remoto autorizado.
- `sync check --require-remote` termina correctamente.

Continúa con [Gestión y uso cotidiano](OPERATIONS_ES.md).
