import { useEffect } from "react";
import { useLocation } from "wouter";

import {
  OFFICE_PATH,
  getCompatibilityRedirect,
} from "@/components/navigation-config";

export default function LegacyCommandCenterPage() {
  const [location, setLocation] = useLocation();

  useEffect(() => {
    setLocation(getCompatibilityRedirect(location) ?? OFFICE_PATH);
  }, [location, setLocation]);

  return null;
}
