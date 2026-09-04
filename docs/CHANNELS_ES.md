# Canales de distribución de AHP+

## Estable: `latest`

El canal recomendado para usuarios es npm `latest`:

```bash
npm install --save-dev @jossuealcala/ahp-plus@latest
```

Cada versión estable tiene además:

- tag Git inmutable `vX.Y.Z`;
- GitHub Release no marcada como prerelease;
- paquete `.tgz` descargable;
- archivo de checksums SHA-256;
- changelog y matriz CI verde.

Para reproducción exacta fija la versión:

```bash
npm install --save-dev @jossuealcala/ahp-plus@1.1.0
```

Una dependencia ya instalada no se actualiza por sí sola. El propietario del
repositorio debe ejecutar una instalación explícita y revisar el cambio de su
lockfile antes de adoptar una versión nueva.

## Desarrollo: `next`

El dist-tag npm `next` publicado actualmente apunta a `1.2.0-dev.0`:

```bash
npm install --save-dev @jossuealcala/ahp-plus@next
```

Para fijar el candidato sin depender de movimientos posteriores del tag:

```bash
npm install --save-dev @jossuealcala/ahp-plus@1.2.0-dev.0
```

El mismo candidato se publica como GitHub prerelease bajo
`v1.2.0-dev.0`. El canal `next` sirve para probar y reportar mejoras; puede
cambiar y no debe sustituir un pin estable en proyectos sensibles.

El árbol fuente candidato de AHP+ 1.4 usa la versión estable `1.4.0`. No debe
describirse como disponible en `latest` hasta que exista autorización explícita,
artefacto publicado y verificación desde el registro público.

## Política de promoción

1. El trabajo ocurre en una rama revisable.
2. `npm run release:check` ejecuta tests, conformance, validación y package
   dry-run; `prepublishOnly` impide omitir este gate al publicar.
3. La matriz CI pasa en Ubuntu, macOS y Windows con Node.js 20 y 22.
4. Una instalación limpia usa el paquete publicado, no el checkout local.
5. El candidato `next` recoge evidencia pública o reproducible.
6. Los hallazgos críticos se resuelven.
7. Una autorización humana explícita permite promover una versión estable.
8. El mismo contenido se publica en GitHub y npm; después se verifica mediante
   una instalación desde ambos canales.

Publicar `next` no mueve `latest`. La promoción estable debe usar la versión
final correspondiente, no renombrar semánticamente el prerelease.

Nunca se presenta `main` como canal instalable oficial.
