# Imagen de produccion para el despliegue en el VPS (Coolify, Railway, Fly, Render).
# Se construye desde cero en el servidor: la imagen no depende del estado local.
#
# ---------------------------------------------------------------------------
# LA CREDENCIAL DEL MODELO NO VA AQUI.
#
# Escribir MINIMAX_API_KEY=... en este Dockerfile grabaria la clave en las capas
# de la imagen: cualquiera que descargue la imagen podria leerla con
# `docker history`. Por eso la clave llega en tiempo de ejecucion:
#
#   - Coolify: Application > Environment Variables > MINIMAX_API_KEY
#   - docker compose: en el `.env` de al lado (chmod 600, esta en .gitignore
#     y en .dockerignore, nunca entra a la imagen)
#   - Docker secrets: /etc/docker/secrets/minimax_key con permisos 400
#
# Ver docker-compose.yml para el montaje completo.
# ---------------------------------------------------------------------------
FROM oven/bun:1.4.3-alpine

WORKDIR /app

# Primero las dependencias: mientras el lockfile no cambie, la capa se cachea.
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

COPY . .

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=3000
ENV LLM_PROVIDER=minimax
# El modelo se puede fijar con LLM_MODEL_MINIMAX en el entorno del contenedor.
ENV LLM_MODEL_MINIMAX=MiniMax-M3.1-Flash

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD bun -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["bun", "run", "src/server.ts"]
