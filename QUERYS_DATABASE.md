# QUERYS_DATABASE.md

Consultas uteis para inspecionar o banco SQLite local.

Banco:

```text
C:\Users\phill\AppData\Local\automation-seguidores\db\automation-seguidores.sqlite
```

As queries abaixo estao fixadas para a conta `appassetlens`.

> Use preferencialmente em modo somente leitura. Evite updates manuais sem backup, porque o banco controla planos, historico, idempotencia e metricas.

## 1. Elegiveis para unfollow por campanha, de 1 a 10 dias

Mostra quantas pessoas entrariam em um plano com `--no-follow-back-after N`, por campanha.

Regra aplicada:

- apenas ciclos ainda abertos;
- apenas follows feitos pela ferramenta;
- apenas `follow_back = 'NO'`;
- exige `follow_back_checked_at`;
- exclui whitelist e protegidos;
- contagem acumulada: `3 dias` inclui quem ja passou de 3, 4, 5 dias etc.

```sql
WITH account AS (
  SELECT id
  FROM local_accounts
  WHERE username_canonical = 'appassetlens'
  LIMIT 1
),
days(day) AS (
  VALUES (1),(2),(3),(4),(5),(6),(7),(8),(9),(10)
),
campaigns_list AS (
  SELECT DISTINCT name AS campaign
  FROM campaigns
),
eligible AS (
  SELECT
    c.name AS campaign,
    rc.id AS cycle_id,
    rc.followed_at,
    rc.follow_back_checked_at
  FROM relationship_cycles rc
  JOIN relationships r ON r.id = rc.relationship_id
  JOIN campaigns c ON c.id = rc.campaign_id
  JOIN account a ON a.id = r.local_account_id
  WHERE rc.unfollowed_at IS NULL
    AND rc.followed_by_tool = 1
    AND rc.origin = 'TOOL_CLICK'
    AND rc.followed_at IS NOT NULL
    AND rc.follow_back = 'NO'
    AND rc.follow_back_checked_at IS NOT NULL
    AND r.whitelisted = 0
    AND r.protected = 0
)
SELECT
  cl.campaign,
  d.day AS no_follow_back_after_days,
  COUNT(e.cycle_id) AS qty
FROM campaigns_list cl
CROSS JOIN days d
LEFT JOIN eligible e
  ON e.campaign = cl.campaign
 AND julianday('now') >= julianday(e.followed_at) + d.day
 AND julianday(e.follow_back_checked_at) >= julianday(e.followed_at) + d.day
GROUP BY cl.campaign, d.day
ORDER BY cl.campaign COLLATE NOCASE, d.day;
```

## 2. Total geral elegivel para unfollow, de 1 a 10 dias

Mesmo criterio da query anterior, mas sem separar por campanha.

```sql
WITH account AS (
  SELECT id
  FROM local_accounts
  WHERE username_canonical = 'appassetlens'
  LIMIT 1
),
days(day) AS (
  VALUES (1),(2),(3),(4),(5),(6),(7),(8),(9),(10)
),
eligible AS (
  SELECT
    rc.id AS cycle_id,
    rc.followed_at,
    rc.follow_back_checked_at
  FROM relationship_cycles rc
  JOIN relationships r ON r.id = rc.relationship_id
  JOIN account a ON a.id = r.local_account_id
  WHERE rc.unfollowed_at IS NULL
    AND rc.followed_by_tool = 1
    AND rc.origin = 'TOOL_CLICK'
    AND rc.followed_at IS NOT NULL
    AND rc.follow_back = 'NO'
    AND rc.follow_back_checked_at IS NOT NULL
    AND r.whitelisted = 0
    AND r.protected = 0
)
SELECT
  d.day AS no_follow_back_after_days,
  COUNT(e.cycle_id) AS qty
FROM days d
LEFT JOIN eligible e
  ON julianday('now') >= julianday(e.followed_at) + d.day
 AND julianday(e.follow_back_checked_at) >= julianday(e.followed_at) + d.day
GROUP BY d.day
ORDER BY d.day;
```

## 3. Quanto tempo levou para observar follow-back

Mostra, para quem seguiu de volta, depois de quantos dias o `YES` foi observado.

Importante: mede quando a ferramenta observou o follow-back, nao necessariamente o minuto exato em que a pessoa seguiu.

```sql
WITH account AS (
  SELECT id
  FROM local_accounts
  WHERE username_canonical = 'appassetlens'
  LIMIT 1
),
yes_cycles AS (
  SELECT
    CAST(MAX(0, julianday(rc.follow_back_checked_at) - julianday(rc.followed_at)) AS INTEGER) AS days_until_observed
  FROM relationship_cycles rc
  JOIN relationships r ON r.id = rc.relationship_id
  JOIN account a ON a.id = r.local_account_id
  WHERE rc.followed_by_tool = 1
    AND rc.origin = 'TOOL_CLICK'
    AND rc.followed_at IS NOT NULL
    AND rc.follow_back = 'YES'
    AND rc.follow_back_checked_at IS NOT NULL
)
SELECT
  days_until_observed AS day,
  COUNT(*) AS qty
FROM yes_cycles
GROUP BY days_until_observed
ORDER BY days_until_observed;
```

## 4. Follow-back observado por campanha e dia

Versao por campanha da query anterior.

```sql
WITH account AS (
  SELECT id
  FROM local_accounts
  WHERE username_canonical = 'appassetlens'
  LIMIT 1
),
yes_cycles AS (
  SELECT
    c.name AS campaign,
    CAST(MAX(0, julianday(rc.follow_back_checked_at) - julianday(rc.followed_at)) AS INTEGER) AS days_until_observed
  FROM relationship_cycles rc
  JOIN relationships r ON r.id = rc.relationship_id
  JOIN campaigns c ON c.id = rc.campaign_id
  JOIN account a ON a.id = r.local_account_id
  WHERE rc.followed_by_tool = 1
    AND rc.origin = 'TOOL_CLICK'
    AND rc.followed_at IS NOT NULL
    AND rc.follow_back = 'YES'
    AND rc.follow_back_checked_at IS NOT NULL
)
SELECT
  campaign,
  days_until_observed AS day,
  COUNT(*) AS qty
FROM yes_cycles
GROUP BY campaign, days_until_observed
ORDER BY campaign COLLATE NOCASE, days_until_observed;
```

## 5. Acumulado de follow-back observado ate cada dia

Ajuda a decidir se vale esperar 3, 4, 5, 6 ou 7 dias antes do unfollow.

```sql
WITH account AS (
  SELECT id
  FROM local_accounts
  WHERE username_canonical = 'appassetlens'
  LIMIT 1
),
days(day) AS (
  VALUES (0),(1),(2),(3),(4),(5),(6),(7),(8),(9),(10)
),
yes_cycles AS (
  SELECT
    CAST(MAX(0, julianday(rc.follow_back_checked_at) - julianday(rc.followed_at)) AS INTEGER) AS days_until_observed
  FROM relationship_cycles rc
  JOIN relationships r ON r.id = rc.relationship_id
  JOIN account a ON a.id = r.local_account_id
  WHERE rc.followed_by_tool = 1
    AND rc.origin = 'TOOL_CLICK'
    AND rc.followed_at IS NOT NULL
    AND rc.follow_back = 'YES'
    AND rc.follow_back_checked_at IS NOT NULL
)
SELECT
  d.day,
  COUNT(y.days_until_observed) AS qty
FROM days d
LEFT JOIN yes_cycles y ON y.days_until_observed <= d.day
GROUP BY d.day
ORDER BY d.day;
```

## 6. Resumo aberto por campanha

Mostra o que ainda esta aberto em cada campanha: seguindo de fato, solicitacao pendente, follow-back `YES`, `NO` e `UNKNOWN`.

```sql
WITH account AS (
  SELECT id
  FROM local_accounts
  WHERE username_canonical = 'appassetlens'
  LIMIT 1
)
SELECT
  c.name AS campaign,
  COUNT(*) AS open_total,
  SUM(CASE WHEN rc.state = 'FOLLOWING' THEN 1 ELSE 0 END) AS following,
  SUM(CASE WHEN rc.state = 'FOLLOW_REQUESTED' THEN 1 ELSE 0 END) AS requested,
  SUM(CASE WHEN rc.follow_back = 'YES' THEN 1 ELSE 0 END) AS follow_back_yes,
  SUM(CASE WHEN rc.follow_back = 'NO' THEN 1 ELSE 0 END) AS follow_back_no,
  SUM(CASE WHEN rc.follow_back = 'UNKNOWN' THEN 1 ELSE 0 END) AS follow_back_unknown
FROM relationship_cycles rc
JOIN relationships r ON r.id = rc.relationship_id
JOIN campaigns c ON c.id = rc.campaign_id
JOIN account a ON a.id = r.local_account_id
WHERE rc.unfollowed_at IS NULL
  AND rc.followed_by_tool = 1
  AND rc.origin = 'TOOL_CLICK'
GROUP BY c.name
ORDER BY c.name COLLATE NOCASE;
```

## 7. Historico por campanha

Mostra o historico geral de follows da ferramenta por campanha, incluindo ciclos ja fechados por unfollow.

```sql
WITH account AS (
  SELECT id
  FROM local_accounts
  WHERE username_canonical = 'appassetlens'
  LIMIT 1
)
SELECT
  c.name AS campaign,
  COUNT(*) AS total_history,
  SUM(CASE WHEN rc.unfollowed_at IS NULL THEN 1 ELSE 0 END) AS open_now,
  SUM(CASE WHEN rc.unfollowed_at IS NOT NULL THEN 1 ELSE 0 END) AS unfollowed,
  SUM(CASE WHEN rc.unfollowed_at IS NULL AND rc.state = 'FOLLOWING' THEN 1 ELSE 0 END) AS following_now,
  SUM(CASE WHEN rc.unfollowed_at IS NULL AND rc.state = 'FOLLOW_REQUESTED' THEN 1 ELSE 0 END) AS requested_now
FROM relationship_cycles rc
JOIN relationships r ON r.id = rc.relationship_id
JOIN campaigns c ON c.id = rc.campaign_id
JOIN account a ON a.id = r.local_account_id
WHERE rc.followed_by_tool = 1
  AND rc.origin = 'TOOL_CLICK'
GROUP BY c.name
ORDER BY c.name COLLATE NOCASE;
```

## 8. Taxa de conversao por campanha

Conta quantas pessoas seguidas pela ferramenta seguiram de volta em cada campanha.

```sql
WITH account AS (
  SELECT id
  FROM local_accounts
  WHERE username_canonical = 'appassetlens'
  LIMIT 1
)
SELECT
  c.name AS campaign,
  COUNT(*) AS followed,
  SUM(CASE WHEN rc.follow_back = 'YES' THEN 1 ELSE 0 END) AS followed_back,
  ROUND(
    100.0 * SUM(CASE WHEN rc.follow_back = 'YES' THEN 1 ELSE 0 END) / NULLIF(COUNT(*), 0),
    2
  ) AS conversion_pct
FROM relationship_cycles rc
JOIN relationships r ON r.id = rc.relationship_id
JOIN campaigns c ON c.id = rc.campaign_id
JOIN account a ON a.id = r.local_account_id
WHERE rc.followed_by_tool = 1
  AND rc.origin = 'TOOL_CLICK'
  AND rc.followed_at IS NOT NULL
GROUP BY c.name
ORDER BY conversion_pct DESC, followed DESC;
```

## 9. Ultimo snapshot de seguidores

Mostra o ultimo snapshot salvo pelo `followers:sync`.

```sql
WITH account AS (
  SELECT id
  FROM local_accounts
  WHERE username_canonical = 'appassetlens'
  LIMIT 1
)
SELECT
  fs.id,
  fs.status,
  fs.expected_count,
  fs.loaded_count,
  fs.observed_at,
  fs.completed_at,
  fs.failure_reason
FROM follower_snapshots fs
JOIN account a ON a.id = fs.local_account_id
ORDER BY fs.observed_at DESC
LIMIT 1;
```

## 10. Itens em revisao ou ambiguos nas ultimas runs

Ajuda a encontrar perfis que travaram ou foram marcados para revisao.

```sql
SELECT
  r.id AS run_id,
  r.type AS run_type,
  r.status AS run_status,
  r.started_at,
  p.username_display AS username,
  a.action_type,
  a.state,
  a.result,
  a.error_category,
  a.screenshot_path
FROM action_attempts a
JOIN runs r ON r.id = a.run_id
JOIN profiles p ON p.id = a.profile_id
WHERE a.state IN ('AMBIGUOUS', 'FAILED', 'SKIPPED')
  AND (
    a.state IN ('AMBIGUOUS', 'FAILED')
    OR a.result LIKE 'NEEDS_REVIEW:%'
  )
ORDER BY r.started_at DESC, a.created_at DESC
LIMIT 100;
```

## 11. Ver historico de um username

Troque `USERNAME_AQUI` pelo perfil que quer investigar.

```sql
WITH account AS (
  SELECT id
  FROM local_accounts
  WHERE username_canonical = 'appassetlens'
  LIMIT 1
),
profile AS (
  SELECT id
  FROM profiles
  WHERE username_canonical = lower('USERNAME_AQUI')
  LIMIT 1
)
SELECT
  p.username_display,
  c.name AS campaign,
  rc.state AS relationship_state,
  rc.origin,
  rc.followed_by_tool,
  rc.followed_at,
  rc.follow_back,
  rc.follow_back_checked_at,
  rc.unfollowed_at,
  rc.unfollow_reason
FROM relationship_cycles rc
JOIN relationships r ON r.id = rc.relationship_id
JOIN profiles p ON p.id = r.profile_id
LEFT JOIN campaigns c ON c.id = rc.campaign_id
JOIN account a ON a.id = r.local_account_id
JOIN profile target ON target.id = p.id
ORDER BY rc.created_at DESC;
```

## 12. Planos recentes

Lista os planos mais recentes e o progresso agregado.

```sql
SELECT
  p.id AS plan_id,
  p.type,
  p.state,
  p.created_at,
  p.frozen_at,
  COUNT(pi.id) AS items,
  SUM(CASE WHEN a.state = 'CONFIRMED' THEN 1 ELSE 0 END) AS confirmed,
  SUM(CASE WHEN a.state = 'SKIPPED' THEN 1 ELSE 0 END) AS skipped,
  SUM(CASE WHEN a.state = 'AMBIGUOUS' THEN 1 ELSE 0 END) AS ambiguous,
  SUM(CASE WHEN a.state = 'FAILED' THEN 1 ELSE 0 END) AS failed
FROM plans p
LEFT JOIN plan_items pi ON pi.plan_id = p.id
LEFT JOIN action_attempts a ON a.plan_item_id = pi.id
GROUP BY p.id
ORDER BY p.created_at DESC
LIMIT 20;
```

## 13. Runs recentes

Mostra as execucoes recentes.

```sql
SELECT
  id AS run_id,
  type,
  mode,
  status,
  plan_id,
  started_at,
  ended_at,
  stop_reason
FROM runs
ORDER BY created_at DESC
LIMIT 30;
```

## 14. Candidatos coletados por campanha e origem

Mostra a composicao da coleta: comentarios, likes, seguidores etc.

```sql
SELECT
  c.name AS campaign,
  cc.discovery_source,
  COUNT(*) AS qty
FROM campaign_candidates cc
JOIN campaigns c ON c.id = cc.campaign_id
GROUP BY c.name, cc.discovery_source
ORDER BY c.name COLLATE NOCASE, qty DESC;
```
