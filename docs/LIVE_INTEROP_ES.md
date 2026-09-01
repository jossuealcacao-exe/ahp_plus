# AHP+ 1.4: instalación e interoperabilidad Codex-Claude

Estado: flujo de desarrollo para `1.4.0-dev.0`. No describe una versión ya
publicada en npm.

## 1. Instalación de un comando

Cuando el prerelease esté autorizado en npm:

```bash
cd /ruta/al/proyecto
npx @jossuealcala/ahp-plus@next setup .
```

Este comando fija AHP+ como dependencia local, crea o actualiza `.ahp/`, instala
las instrucciones de Codex y Claude, registra el servidor MCP en
`.codex/config.toml` y `.mcp.json`, crea una identidad por plataforma fuera de
Git y ejecuta `doctor` más `verify --strict`. Puede repetirse sin duplicar
archivos, identidades ni bloques administrados.

En el checkout de desarrollo de AHP+ se usa:

```bash
node bin/ahp.mjs setup /ruta/al/proyecto --no-install
```

Después abre el mismo repositorio en Codex y Claude Code. Reinicia el chat o la
aplicación si el host solo carga servidores MCP al abrir el proyecto.

## 2. Consulta desde el mismo chat

En Codex:

```text
Usa AHP+ para preguntarle a Claude, en solo lectura, cuál es el mayor riesgo de
la implementación actual. Muéstrame su respuesta y los fingerprints.
```

En Claude Code se invierte el destino:

```text
Usa AHP+ para pedirle a Codex una revisión de solo lectura de este cambio.
Devuélveme una sola respuesta y sus fingerprints.
```

El adaptador llama `ahp_consult` por MCP o, como respaldo, ejecuta:

```bash
ahp agent ask claude "PREGUNTA" --from codex
ahp agent ask codex "PREGUNTA" --from claude
```

Desde MCP también puede limitarse la consulta con `model`, `timeout` (segundos)
y `max_budget_usd` (para Claude, mayor que 0 y hasta 20 USD). Estos límites no
conceden permisos de escritura: la consulta sigue siendo de solo lectura y de
un solo salto.

Resultado esperado: `status: CONSULTED`, un evento `CONSULT_REQUEST`, otro
`CONSULT_RESPONSE`, fingerprints distintos y un padre causal válido. El agente
consultado opera con sandbox de solo lectura y un máximo de un salto. No puede
editar, delegar otra consulta, hacer commit, push, deploy ni publicar.

## 3. Mensaje cifrado entre dos dispositivos

Obtén las identidades creadas por setup:

```bash
ahp identity list
```

Primero crea el evento seleccionado:

```bash
ahp message send "Revisa el estado actual" --from codex --to claude
```

Para una prueba local usa un directorio como carrier:

```bash
ahp secure send EVT-... --from-device DEV-CODEX --to-device DEV-CLAUDE \
  --channel /ruta/privada/ahp-channel
ahp secure receive --as-device DEV-CLAUDE --channel /ruta/privada/ahp-channel
ahp secure confirm --as-device DEV-CODEX --channel /ruta/privada/ahp-channel
```

El receptor debe devolver `RECEIVED`; el emisor, `DELIVERY_CONFIRMED`. El
fingerprint del EVT debe ser idéntico en ambos extremos y el recibo `SRC` debe
mostrar firma válida.

## 4. Carrier de red de referencia

Crea un token aleatorio fuera de Git y protégelo:

```bash
openssl rand -hex 32 > /ruta/privada/ahp-hub.token
chmod 600 /ruta/privada/ahp-hub.token
```

Para una prueba local:

```bash
ahp hub serve --host 127.0.0.1 --port 8787 \
  --data-dir /ruta/privada/ahp-hub-data \
  --token-file /ruta/privada/ahp-hub.token
```

En otra sesión:

```bash
ahp secure network send EVT-... --from-device DEV-CODEX --to-device DEV-CLAUDE \
  --url http://127.0.0.1:8787 --token-file /ruta/privada/ahp-hub.token
ahp secure network receive --as-device DEV-CLAUDE \
  --url http://127.0.0.1:8787 --token-file /ruta/privada/ahp-hub.token
ahp secure network confirm --as-device DEV-CODEX \
  --url http://127.0.0.1:8787 --token-file /ruta/privada/ahp-hub.token
```

Una interfaz que no sea loopback exige `--tls-cert` y `--tls-key`. Para Internet
también se necesitan operación del servidor, DNS, firewall, respaldo y política
de retención; AHP+ no provee un SaaS público en esta versión.

## 5. Qué acredita cada capa

| Evidencia | Acredita | No acredita |
|---|---|---|
| EVT | Contenido y cadena causal intactos | Entrega o identidad |
| RLY/RCP | Posesión del secreto compartido y recibo | Dispositivo único o cifrado |
| SEC/SRC | Cifrado, posesión de claves registradas y entrega firmada | Persona o modelo exacto |
| Consulta MCP | Una respuesta acotada del CLI de plataforma | Ejecución de cambios |
| Git remoto | Estado confirmado y portable | Autoridad para modificarlo |

La liberación de 1.4 requiere además pruebas completas, conformance, validación
estricta, paquete npm inspeccionado, CI multiplataforma y una recepción real
desde un consumidor independiente.
