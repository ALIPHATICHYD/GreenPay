import { useEffect } from "react";
import { getSocket } from "@/lib/socket";

export interface DonationSocketPayload {
  projectId: string;
  donorAddress: string;
  amountXLM: number;
  transactionHash: string;
  timestamp: string;
}

/**
 * Subscribes to the backend's "donation_event" Socket.io broadcast and invokes
 * `onDonation` for events matching `projectId`.
 */
export function useDonationSocket(projectId: string | undefined, onDonation: (payload: DonationSocketPayload) => void) {
  useEffect(() => {
    if (!projectId) return;

    const socket = getSocket();
    const handleEvent = (payload: DonationSocketPayload) => {
      if (payload.projectId === projectId) {
        onDonation(payload);
      }
    };

    socket.on("donation_event", handleEvent);
    return () => {
      socket.off("donation_event", handleEvent);
    };
  }, [projectId, onDonation]);
}
