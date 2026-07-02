# Use an official lightweight Python runtime as a base image
FROM python:3.11-slim

# Set the working directory inside the container
WORKDIR /app

# Copy dependency file first to leverage Docker caching
COPY requirements.txt .

# Install dependencies without caching the installation files locally
RUN pip install --no-cache-dir -r requirements.txt

# Copy the rest of the application code
COPY . .

# Specify the command to execute when the container starts
CMD ["uvicorn", "server:app", "--host=0.0.0.0", "--port=8000", "--reload"]