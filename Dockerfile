# Imagen de produccion para el despliegue en el VPS (Coolify, Railway, Fly, Render).
# Se construye desde cero en el servidor: la imagen no depende del estado local.
FROM oven/bun:1.4.3-alpine

WORKDIR /app

# Primero las dependencias: mientras el lockfile no cambie, la capa se cachea.
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

COPY . .

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=3000
ENV LLM_PROVIDER=auto

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD bun -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["bun", "run", "src/server.ts"]
