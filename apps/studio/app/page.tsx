import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Slider } from "@/components/ui/slider";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

/** Disposable theme smoke-test page — replace with the real studio home. */
export default function Home() {
  return (
    <div className="flex min-h-screen items-center justify-center p-8">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>FizzStudio</CardTitle>
          <CardDescription>Dark theme smoke test</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <Tabs defaultValue="image">
            <TabsList className="w-full">
              <TabsTrigger value="image">Image</TabsTrigger>
              <TabsTrigger value="video">Video</TabsTrigger>
              <TabsTrigger value="audio">Audio</TabsTrigger>
            </TabsList>
          </Tabs>
          <Input placeholder="Describe what you want to create…" />
          <Slider defaultValue={[60]} max={100} step={1} />
          <div className="flex items-center gap-2">
            <Button>Generate</Button>
            <Button variant="secondary">Secondary</Button>
            <Button variant="outline">Outline</Button>
            <Button variant="ghost">Ghost</Button>
          </div>
          <div className="flex items-center gap-2">
            <Badge>Default</Badge>
            <Badge variant="secondary">Secondary</Badge>
            <Badge variant="outline">Outline</Badge>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
