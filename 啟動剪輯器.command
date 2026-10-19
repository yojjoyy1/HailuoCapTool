#!/bin/bash
cd "$(dirname "$0")"
(sleep 1 && open "http://localhost:5173") &
node server.js
