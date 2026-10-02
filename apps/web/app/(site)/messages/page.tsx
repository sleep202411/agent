import { RecruitmentInbox } from "./_components/recruitment-inbox";
import { ChatInbox } from "./_components/chat-inbox";
import { NotificationsFeed } from "./_components/notifications-feed";

export default async function MessagesPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const { tab } = await searchParams;
  return tab === "notifications" ? (
    <NotificationsFeed />
  ) : tab === "recruitment" ? (
    <RecruitmentInbox />
  ) : (
    <ChatInbox />
  );
}
