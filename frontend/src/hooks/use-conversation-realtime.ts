"use client";

import { useEffect } from "react";
import type { Dispatch, SetStateAction } from "react";
import { io } from "socket.io-client";
import { API_BASE_URL, api } from "@/lib/api";
import type { InboxMessage } from "@/components/dashboard-tabs/conversations-workspace";

type Props = {
  enabled: boolean;
  organizationId?: string;
  conversationId?: string;
  conversationOrganizationId?: string;
  setMessages: Dispatch<SetStateAction<InboxMessage[]>>;
  setConnected: Dispatch<SetStateAction<boolean>>;
  setNotification: Dispatch<SetStateAction<string | null>>;
};

function orderMessages(messages: InboxMessage[]): InboxMessage[] {
  return [...messages].sort(
    (a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id),
  );
}

/** Owns exactly one active room and disconnects as soon as its identity changes. */
export function useConversationRealtime({
  enabled, organizationId, conversationId, conversationOrganizationId,
  setMessages, setConnected, setNotification,
}: Props): void {
  useEffect(() => {
    if (!enabled || !organizationId || !conversationId ||
        conversationOrganizationId !== organizationId) {
      setConnected(false);
      return;
    }

    let active = true;
    const socket = io(new URL(API_BASE_URL, window.location.origin).origin, {
      withCredentials: true,
    });

    socket.on("connect", () => {
      if (!active) return;
      setConnected(true);
      socket.emit("join_room", { organizationId, conversationId });
      void api.get<InboxMessage[]>(`/conversations/${conversationId}/messages`)
        .then(({ data }) => {
          if (!active) return;
          setMessages((current) => {
            const latest = new Map<string, InboxMessage>();
            for (const message of data) {
              if (message.conversationId === conversationId) latest.set(message.id, message);
            }
            for (const message of current) {
              if (message.conversationId === conversationId) latest.set(message.id, message);
            }
            return orderMessages([...latest.values()]);
          });
        })
        .catch(() => {
          if (active) setNotification("Nachrichten konnten nicht aktualisiert werden.");
        });
    });

    socket.on("new_message", (message: InboxMessage) => {
      if (!active || message?.conversationId !== conversationId || !message.id) return;
      setMessages((current) =>
        current.some((item) => item.id === message.id)
          ? current
          : orderMessages([...current.filter((item) => item.conversationId === conversationId), message]),
      );
    });
    const disconnected = () => { if (active) setConnected(false); };
    socket.on("disconnect", disconnected);
    socket.on("connect_error", disconnected);
    socket.on("error", disconnected);

    return () => {
      active = false;
      socket.disconnect();
      setConnected(false);
    };
  }, [enabled, organizationId, conversationId, conversationOrganizationId,
    setMessages, setConnected, setNotification]);
}
