# Qué diferencia a AHP+ y dónde encaja

## El problema

Un agente puede tener herramientas, instrucciones y una sesión activa, pero al
cambiar de modelo, editor, cuenta o máquina suele perder una respuesta
verificable a estas preguntas:

- ¿Cuál es el repositorio y commit correctos?
- ¿Qué estado fue confirmado y con qué certeza?
- ¿Qué decisiones siguen vigentes?
- ¿Qué pruebas realmente se ejecutaron?
- ¿Qué falta y qué está bloqueado?
- ¿El siguiente agente puede reproducir el contexto desde Git?
- ¿Existe autoridad para una acción externa?

AHP+ ocupa ese espacio: continuidad durable y verificable de un proyecto,
anclada a un repositorio Git.

## La capa que añade

```text
Persona y políticas de la organización
  -> instrucciones del repositorio (AGENTS.md y equivalentes)
    -> AHP+: estado, evidencia, autoridad y handoff durables
      -> host o editor del agente (ACP puede conectar ambos)
        -> agente y otros agentes (A2A puede conectarlos)
          -> herramientas, datos y servicios (MCP puede conectarlos)
            -> Git transporta y audita el estado AHP+
```

Las capas pueden combinarse. No son sustitutos directos.

## Comparación de responsabilidades

| Capa | Pregunta principal | Qué conserva | Relación con AHP+ |
|---|---|---|---|
| `AGENTS.md` | ¿Cómo debe trabajar un agente en este árbol? | instrucciones Markdown versionadas | AHP+ puede instalar una entrada que obliga a leer y verificar el estado durable. |
| MCP | ¿Cómo accede una aplicación de IA a herramientas, datos y prompts? | contrato de conexión y capacidades; no el estado Git del proyecto | AHP+ puede usar herramientas disponibles por MCP, pero exige evidencia de su ejecución. |
| A2A | ¿Cómo colaboran agentes independientes en tiempo de ejecución? | mensajes, tareas y artefactos entre agentes | AHP+ conserva el límite durable antes y después de esa colaboración. |
| ACP | ¿Cómo se comunica un agente con un cliente o editor? | sesión interactiva cliente-agente | AHP+ sobrevive cuando cambia el cliente, la sesión o el agente. |
| Memoria del proveedor | ¿Qué recuerda esta cuenta o conversación? | contexto útil pero dependiente del proveedor | AHP+ la trata como caché secundaria, no como prueba canónica. |
| Git | ¿Qué contenido e historial fueron confirmados? | commits, árboles, ramas y remotos | AHP+ añade semántica tipada sobre Git sin ejecutar mutaciones de red. |

Referencias de las otras capas:

- [AGENTS.md](https://agents.md/)
- [Model Context Protocol](https://modelcontextprotocol.io/docs/getting-started/intro)
- [Agent2Agent Protocol](https://a2a-protocol.org/latest/)
- [Agent Client Protocol](https://agentclientprotocol.com/get-started/architecture)

## Diferenciadores de AHP+

### El repositorio es la identidad

Cada instancia pertenece a una sola raíz Git. Un workspace padre no puede
prestar su rama o commit a un repositorio hijo.

### Las afirmaciones tienen certeza y evidencia

AHP+ distingue entre `VERIFIED`, `USER_CONFIRMED`, `INFERRED`, `UNVERIFIED`,
`STALE` y `CONFLICTED`. Un PASS de QA requiere referencias a evidencia; el texto
del modelo por sí solo no prueba ejecución.

### El handoff se verifica

Los checkpoints y handoffs tienen integridad canónica. El receptor compara
proyecto, commit, árbol, rama y cambios locales antes de declarar `READY`.

### La portabilidad es explícita

AHP+ diferencia estado local, estado que necesita push, divergencia y estado
remoto listo. Evita presentar como portable algo que existe solo en una sesión
o máquina.

### La autoridad no se infiere

Un handoff, un checkpoint o una recomendación no autorizan commit, push, merge,
deploy, publicación, pagos ni otras acciones externas. La autoridad debe venir
de la persona o política correspondiente.

### El núcleo no depende del proveedor

El protocolo es normativo; el CLI de Node.js es la implementación de referencia.
Los adaptadores traducen convenciones de distintas plataformas sin cambiar el
significado del estado.

## Qué no es AHP+

- No es una memoria vectorial ni un historial completo de conversaciones.
- No es un orquestador de agentes.
- No es un servidor MCP, un agente A2A ni un transporte ACP.
- No es un sistema de permisos ni un sustituto de las protecciones del remoto.
- No hace commit, push, pull, merge, deploy ni publicación.
- No garantiza que una afirmación sea cierta si la evidencia registrada es mala.
- No sustituye pruebas, revisión humana, backups o gestión de secretos.

## Cuándo aporta valor

Úsalo cuando un proyecto pasa entre modelos, IDEs, personas o máquinas; cuando
varias sesiones pueden tocar el mismo repositorio; cuando necesitas distinguir
hechos de inferencias; o cuando una entrega debe continuar después de cerrar el
chat original.

Puede ser excesivo para una consulta sin repositorio, un script desechable o una
tarea cuya continuidad no necesita persistirse.
