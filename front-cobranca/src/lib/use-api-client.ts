"use client";

import { useSession } from "next-auth/react";
import { useMemo } from "react";
import { ApiClient } from "./api-client";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";

export function useApiClient() {
  const { data: session } = useSession();

  const client = useMemo(() => {
    const apiClient = new ApiClient(API_URL);
    if (session?.access_token) {
      apiClient.setToken(session.access_token);
    }
    return apiClient;
  }, [session]);

  return client;
}