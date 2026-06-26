export const API_URL = import.meta.env.VITE_API_URL || "http://localhost:5002";

export async function readApiResponse(response) {
  const contentType = response.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    return response.json();
  }

  return { error: await response.text() };
}

export function getFriendlyError(error) {
  if (error.message === "Failed to fetch") {
    return `Could not reach the backend. Make sure it is running on ${API_URL}, then restart npm run dev.`;
  }

  return error.message;
}
