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

## Desarrollo: `next`

Los cambios futuros usan versiones prerelease, por ejemplo
`1.1.1-dev.0`, y el dist-tag npm `next`:

```bash
npm install --save-dev @jossuealcala/ahp-plus@next
```

El mismo candidato se publica como GitHub prerelease bajo
`v1.1.1-dev.0`. El canal `next` sirve para probar y reportar mejoras; puede
cambiar y no debe sustituir un pin estable en proyectos sensibles.

## Política de promoción

1. El trabajo ocurre en una rama revisable.
2. Tests, conformance, validación, package dry-run e instalación limpia pasan.
3. El candidato `next` recoge evidencia pública o reproducible.
4. Los hallazgos críticos se resuelven.
5. Una autorización humana explícita permite promover una versión estable.
6. El mismo contenido se publica en GitHub y npm; después se verifica mediante
   una instalación desde ambos canales.

Nunca se presenta `main` como canal instalable oficial.
