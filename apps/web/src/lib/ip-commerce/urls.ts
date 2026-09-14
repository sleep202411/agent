/** Public room links never use the legacy /ips/{javaId} numeric namespace. */
export function ipRoomPath(roomNumber: string): string {
  return `/ip/${roomNumber}`;
}
