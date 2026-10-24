---
name: "xauusd-trading-bot"
description: "XAU/USD algorithmic trading bot via OANDA API — spec, roadmap, and status"
---

- Building an XAU/USD (gold/USD) algorithmic trading bot via OANDA API
- Pivoted to this from a prediction markets bot
- Full v1.0 specification, CLAUDE.md, and module skills have been delivered
- A 15-stage development roadmap with paper-trading gate criteria is defined
- Bot architecture uses Numba @njit Kalman filter + OBI + FVG (SMC) confluência tripla; deploy target AMS1 (Paperspace) via OANDA API ~5 ticks/s
- Iterating through versioned engine files (V2 → V3 → V3.1); critical bugs tracked and analyzed across versions; V3.1 nearly deploy-ready pending SyntaxError fix and paper trading validation
- Skill paperspace-trading criada para orientar deploy no Paperspace AMS1
- Decisão final de arquitetura: execução de ordens continua via Python + API OANDA (não migrou para MT5); MetaTrader 5 usado apenas como painel visual somente leitura, aberto localmente sob demanda (sem VPS Windows 24/7); alertas via Telegram (sem dashboard web separado)
- Plano de desenvolvimento oficial criado consolidando escopo do MVP, ADRs, EAP/WBS, cronograma, riscos e infraestrutura; infraestrutura definitiva escolhida: Paperspace (região AMS1)
- Decisão de arquitetura: IA (Claude/Anthropic API) usada não só para notícias, mas também como Gate 4 de julgamento de qualidade do sinal técnico (aprova/rejeita/ajusta stop, com fail-safe); histórico de preços passou a ser persistido em SQLite para permitir backtest antes de operar ao vivo; documentos oficiais criados: casos de uso (12 UCs) e backlog priorizado (15 histórias US-01 a US-15)
