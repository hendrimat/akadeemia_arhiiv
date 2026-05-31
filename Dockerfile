# Use an official Python runtime as a parent image
FROM python:3.10-slim

# Set the working directory in the container
WORKDIR /app

# Copy the requirements file into the container
COPY requirements.txt .

# Install dependencies
# We use --no-cache-dir to reduce image size
RUN pip install --no-cache-dir -r requirements.txt

# Copy the rest of your application code into the container
COPY . .

# Environment variables
ENV FLASK_APP=app.py
ENV FLASK_RUN_HOST=0.0.0.0

# Gunicorn execution
# Shift context to app/web to isolate the application module
# Bind to 8080 to satisfy Cloud Run ingress
CMD ["gunicorn", "--chdir", "app/web", "--bind", "0.0.0.0:8080", "--workers=1", "--threads=2", "--timeout=300", "app:app"]