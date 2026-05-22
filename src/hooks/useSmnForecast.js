import { useCallback, useEffect, useState } from "react";

export default function useSmnForecast() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/forecast/tabasco", { cache: "no-store" });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || `Error ${res.status}`);
      setData(body);
    } catch (e) {
      setError(e.message || "No se pudo cargar el pronóstico");
      setData(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return {
    data,
    loading,
    error,
    reload: load,
    municipalities: data?.municipalities ?? [],
    updatedAt: data?.updatedAt ?? null,
    source: data?.source ?? "SMN-CONAGUA",
  };
}
