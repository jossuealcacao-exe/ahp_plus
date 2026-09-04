# Canales de distribución de AHP+

## Estable: `latest`

El canal recomendado para personas usuarias es npm `latest`. La vía más simple
instala y configura AHP+ `1.4.0` en el proyecto en un paso:

```bash
npx @jossuealcala/ahp-plus@1.4.0 setup .
```

Para una reproducción exacta fija la misma versión:

```bash
npm install --save-dev @jossuealcala/ahp-plus@1.4.0
```

Una dependencia ya instalada no se actualiza sola. La persona propietaria debe
instalar de forma explícita, revisar el lockfile y confirmar los archivos de
integración antes de adoptar una versión nueva.

Cada versión estable incluye un tag Git inmutable `vX.Y.Z`, una GitHub Release
no prerelease, paquete `.tgz`, checksums SHA-256, changelog y matriz CI verde.

## Desarrollo: `next`

Un prerelease usa el dist-tag `next` y una versión exacta con sufijo
prerelease. Sirve para pruebas y feedback; no sustituye un pin estable en
proyectos sensibles. Publicar `next` no mueve `latest`.

Las versiones estables se anuncian como disponibles únicamente después de que
la publicación en npm y una instalación nueva desde el registro hayan sido
verificadas.

## Política de promoción

1. El trabajo ocurre en una rama revisable.
2. `npm run release:check` ejecuta tests, conformance, validación y package
   dry-run; `prepublishOnly` impide omitir este gate al publicar.
3. La matriz CI pasa en Ubuntu, macOS y Windows con Node.js 20 y 22.
4. Una instalación limpia prueba el paquete publicado, no el checkout local.
5. Los hallazgos críticos se resuelven.
6. Una autorización humana explícita permite promover una versión estable.
7. El mismo contenido se publica en GitHub y npm; después se verifica desde
   ambos canales.

Nunca se presenta `main` como canal instalable oficial.
