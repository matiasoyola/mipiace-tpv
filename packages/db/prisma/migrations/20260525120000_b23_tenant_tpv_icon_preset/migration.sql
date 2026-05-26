-- v1.3-hotfix6 · subvertical del tenant para el icono placeholder del TPV.
--
-- Texto libre con valores soportados conocidos en el front: "haircut",
-- "medical", "auto_repair", "beauty", "fitness", "education". NULL =
-- usar el icono genérico del businessType. No restringimos con check
-- constraint porque querremos añadir presets sin migración (solo TPV).

ALTER TABLE "tenants" ADD COLUMN "tpv_icon_preset" TEXT;
