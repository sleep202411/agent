import { useLocalSearchParams } from "expo-router";
import { OrderDetail } from "@/features/services/order-detail";
export default function OrderRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <OrderDetail id={typeof id === "string" ? id : ""} />;
}
