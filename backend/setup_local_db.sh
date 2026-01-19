#!/bin/bash
# Local PostgreSQL Setup Script for macOS

echo "🔧 Setting up local PostgreSQL database..."

# Check if PostgreSQL is installed
if ! command -v psql &> /dev/null; then
    echo "❌ PostgreSQL is not installed."
    echo "Please install it first:"
    echo "  brew install postgresql@15"
    echo "  brew services start postgresql@15"
    exit 1
fi

# Get current username
USERNAME=$(whoami)
echo "📝 Using username: $USERNAME"

# Check if PostgreSQL is running
if ! pg_isready -q; then
    echo "⚠️  PostgreSQL is not running. Starting it..."
    brew services start postgresql@15 2>/dev/null || pg_ctl -D /usr/local/var/postgresql@15 start 2>/dev/null
    sleep 2
fi

# Check if database already exists
if psql -U "$USERNAME" -lqt | cut -d \| -f 1 | grep -qw email_agent; then
    echo "✅ Database 'email_agent' already exists"
else
    echo "📦 Creating database 'email_agent'..."
    createdb -U "$USERNAME" email_agent
    if [ $? -eq 0 ]; then
        echo "✅ Database 'email_agent' created successfully"
    else
        echo "❌ Failed to create database"
        echo ""
        echo "Trying alternative method..."
        psql -U "$USERNAME" postgres -c "CREATE DATABASE email_agent;"
    fi
fi

# Enable pgvector extension (if available)
echo "🔌 Enabling pgvector extension..."
psql -U "$USERNAME" -d email_agent -c "CREATE EXTENSION IF NOT EXISTS vector;" 2>/dev/null
if [ $? -eq 0 ]; then
    echo "✅ pgvector extension enabled"
else
    echo "⚠️  pgvector extension not available (this is OK if you're not using RAG yet)"
fi

echo ""
echo "✅ Database setup complete!"
echo ""
echo "📝 Update your backend/.env file with:"
echo "   DATABASE_HOST=localhost"
echo "   DATABASE_PORT=5432"
echo "   DATABASE_NAME=email_agent"
echo "   DATABASE_USER=$USERNAME"
echo "   DATABASE_PASSWORD="
echo ""
echo "Then run: python test_db_connection.py"
