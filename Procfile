web: python3 init_production.py && gunicorn -w 1 --threads 4 --max-requests 200 --max-requests-jitter 50 -b 0.0.0.0:$PORT --timeout 300 app:app
