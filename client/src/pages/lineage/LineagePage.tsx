import { useEffect } from "react";
import { useLocation } from "wouter";

import {
  DEBUG_LINEAGE_PATH,
  getCompatibilityRedirect,
} from "@/components/navigation-config";

export default function LineagePage() {
  const [location, setLocation] = useLocation();

  useEffect(() => {
    setLocation(getCompatibilityRedirect(location) ?? DEBUG_LINEAGE_PATH);
  }, [location, setLocation]);

  return null;
}
