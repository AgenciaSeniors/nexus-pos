-- ============================================================================
-- Modo restaurante — Fase 2: KDS (cocina) + Realtime
-- ============================================================================
-- Implementa la "propiedad de columnas disjunta": el mesero y la cocina (KDS)
-- escriben conjuntos de columnas distintos de comanda_items, así nunca se pisan.
--   - upsert_comanda_item: SOLO columnas del mesero (cantidad/precio/nota/...).
--   - set_kitchen_status:  SOLO columnas de cocina (kitchen_status/sent_at/ready_at).
-- Y habilita Realtime en comandas/comanda_items para el KDS.
--
-- Requiere las tablas de la Fase 1 + get_user_business_id()/is_super_admin().
-- Aplicar con confirmación al proyecto REAL de nexus-pos (NO a TriciGo).
-- ============================================================================

-- --------------------------------------------------------------------------
-- 1. upsert_comanda_item — escribe SOLO columnas del mesero
-- --------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.upsert_comanda_item(p_item jsonb)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_business uuid := (p_item->>'business_id')::uuid;
BEGIN
  IF v_business <> get_user_business_id() AND NOT is_super_admin() THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  INSERT INTO comanda_items (
    id, comanda_id, business_id, product_id, name, quantity, price, custom_price,
    note, modifiers, modifiers_total, course, voided, item_updated_at
  ) VALUES (
    (p_item->>'id')::uuid,
    (p_item->>'comanda_id')::uuid,
    v_business,
    (p_item->>'product_id')::uuid,
    p_item->>'name',
    COALESCE((p_item->>'quantity')::numeric, 1),
    COALESCE((p_item->>'price')::numeric, 0),
    NULLIF(p_item->>'custom_price', '')::numeric,
    p_item->>'note',
    CASE WHEN p_item ? 'modifiers' THEN p_item->'modifiers' ELSE NULL END,
    NULLIF(p_item->>'modifiers_total', '')::numeric,
    NULLIF(p_item->>'course', '')::integer,
    COALESCE((p_item->>'voided')::boolean, false),
    now()
  )
  ON CONFLICT (id) DO UPDATE SET
    quantity        = EXCLUDED.quantity,
    price           = EXCLUDED.price,
    custom_price    = EXCLUDED.custom_price,
    note            = EXCLUDED.note,
    modifiers       = EXCLUDED.modifiers,
    modifiers_total = EXCLUDED.modifiers_total,
    course          = EXCLUDED.course,
    voided          = EXCLUDED.voided,
    item_updated_at = now();
  -- kitchen_status / sent_at / ready_at NO se tocan aquí: los posee el KDS.
END; $$;

GRANT EXECUTE ON FUNCTION public.upsert_comanda_item TO authenticated;

-- --------------------------------------------------------------------------
-- 2. set_kitchen_status — escribe SOLO columnas de cocina
-- --------------------------------------------------------------------------
-- Las columnas de cocina son de propiedad exclusiva del KDS, así que aplicar el
-- último estado recibido es seguro (no hay contención con el mesero). Igualmente
-- registramos item_updated_at para frescura del pull/merge.
CREATE OR REPLACE FUNCTION public.set_kitchen_status(
  p_item_id uuid,
  p_business_id uuid,
  p_status text,
  p_item_updated_at timestamptz
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF p_business_id <> get_user_business_id() AND NOT is_super_admin() THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF p_status NOT IN ('pending','sent','preparando','listo','served','cancelled') THEN
    RAISE EXCEPTION 'estado de cocina inválido: %', p_status;
  END IF;

  UPDATE comanda_items
  SET kitchen_status = p_status,
      sent_at  = CASE WHEN p_status = 'sent'  AND sent_at  IS NULL THEN now() ELSE sent_at  END,
      ready_at = CASE WHEN p_status = 'listo'                      THEN now() ELSE ready_at END,
      item_updated_at = p_item_updated_at
  WHERE id = p_item_id AND business_id = p_business_id;
END; $$;

GRANT EXECUTE ON FUNCTION public.set_kitchen_status TO authenticated;

-- --------------------------------------------------------------------------
-- 3. Realtime: publicar comandas y comanda_items (alta rotación)
-- --------------------------------------------------------------------------
-- No publicamos products/sales: el volumen Realtime queda acotado al KDS/plano.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'comandas'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.comandas;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'comanda_items'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.comanda_items;
  END IF;
END $$;
