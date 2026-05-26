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

# Environment variable for Flask
ENV FLASK_APP=app.py
ENV FLASK_RUN_HOST=0.0.0.0

# Gunicorn is a production-grade server
# We use 1 worker and 2 threads.
# We set a long timeout (300s) to allow for slow model loading at startup.
CMD ["gunicorn", "--workers=1", "--threads=2", "--timeout=300", "app:app"]