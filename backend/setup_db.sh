#!/bin/bash
# GCP Cloud SQL PostgreSQL Setup Script
# Make sure you have gcloud CLI installed and authenticated

PROJECT_ID="email-agent-484700"
INSTANCE_ID="email-agent-db"
DATABASE_NAME="email_agent"
DB_USER="postgres"
REGION="us-central1"

echo "Creating Cloud SQL PostgreSQL instance..."

# Create Cloud SQL instance
gcloud sql instances create $INSTANCE_ID \
  --database-version=POSTGRES_15 \
  --tier=db-f1-micro \
  --region=$REGION \
  --storage-type=SSD \
  --storage-size=10GB \
  --storage-auto-increase \
  --backup-start-time=03:00 \
  --enable-bin-log \
  --maintenance-window-day=SUN \
  --maintenance-window-hour=04 \
  --authorized-networks=0.0.0.0/0 \
  --project=$PROJECT_ID

echo "Instance created. Waiting for it to be ready..."
sleep 30

# Set root password (you'll be prompted)
echo "Please set the root password:"
gcloud sql users set-password $DB_USER \
  --instance=$INSTANCE_ID \
  --password=$(openssl rand -base64 32) \
  --project=$PROJECT_ID

# Create database
echo "Creating database..."
gcloud sql databases create $DATABASE_NAME \
  --instance=$INSTANCE_ID \
  --project=$PROJECT_ID

echo "Setup complete!"
echo "Connection string will be shown after instance is fully ready."
echo "You can find connection details in GCP Console: https://console.cloud.google.com/sql/instances/$INSTANCE_ID/overview?project=$PROJECT_ID"
