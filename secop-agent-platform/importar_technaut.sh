#!/bin/bash
# Script para importar TechNaut SAS al sistema
# Uso: bash importar_technaut.sh

API_URL="${API_URL:-http://localhost:3001}"
API_KEY="${API_KEY:-dev-key-change-in-production}"

echo "Importando TechNaut SAS..."
echo "API: $API_URL"

RESPONSE=$(curl -s -X POST "$API_URL/api/companies" \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d @technaut_sas.json)

echo "Respuesta:"
echo "$RESPONSE" | python3 -m json.tool 2>/dev/null || echo "$RESPONSE"
