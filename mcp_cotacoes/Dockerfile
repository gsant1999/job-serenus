FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app

COPY mcp_cotacoes/requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir -r /app/requirements.txt \
    && useradd --create-home --uid 10001 mcp

COPY mcp_cotacoes/__init__.py mcp_cotacoes/auth.py mcp_cotacoes/client.py \
     mcp_cotacoes/models.py mcp_cotacoes/server.py /app/mcp_cotacoes/

USER mcp
EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
    CMD ["python", "-c", "import os,socket; s=socket.create_connection(('127.0.0.1',int(os.environ.get('PORT',os.environ.get('MCP_PORT','8000')))),2); s.close()"]

CMD ["python", "-m", "mcp_cotacoes.server"]
