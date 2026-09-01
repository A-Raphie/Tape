# Tape: desk loop + sidecar + panel, one container.
# Keys come from environment (Railway variables), NEVER from the image.

FROM node:22-slim AS panel
WORKDIR /build
COPY panel/package.json panel/package-lock.json ./
RUN npm ci
COPY panel ./
RUN npm run build

FROM python:3.12-slim
WORKDIR /app
COPY agent/requirements.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt
COPY agent ./agent
COPY --from=panel /build/out ./panel/out
# journal seed so open trades survive the local -> cloud handover
COPY agent/data ./agent/data
ENV TAPE_DB=/data/tape.db
ENV PYTHONPATH=/app/agent/src
EXPOSE 8000
CMD ["sh", "-c", "mkdir -p /data && if [ ! -f /data/tape.db ]; then tar xzf agent/data/seed.tar.gz -C /data; fi && uvicorn tape.api:app --host 0.0.0.0 --port ${PORT:-8814} & exec python agent/scripts/run_desk.py"]
