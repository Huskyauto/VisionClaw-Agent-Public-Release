import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { FELIX_SPARK_OFFERS } from "@/data/felix-spark-offers";
import { FolderOpen, LockKeyhole, PackageCheck } from "lucide-react";

export default function AdminFelixSparkOffersPage() {
  const [selected, setSelected] = useState(FELIX_SPARK_OFFERS[0].slug);

  return (
    <main className="h-full overflow-y-auto" data-testid="felix-spark-offers-page">
      <div className="mx-auto max-w-6xl space-y-6 p-4 sm:p-6">
        <header className="space-y-3">
          <Badge variant="outline">Owner planning area · Not for sale</Badge>
          <h1 className="text-2xl font-bold sm:text-3xl">Felix + Spark: five separate offers</h1>
          <p className="max-w-3xl text-sm leading-6 text-muted-foreground">
            Each tab answers the buyer&apos;s question: “What do I give you, and what do I get back?”
            These are proposed descriptions, not products you can order. Every offer stays on hold
            until its sample, safety checks, price, and delivery are approved.
          </p>
          <p className="flex items-start gap-2 text-xs text-muted-foreground">
            <FolderOpen className="mt-0.5 h-4 w-4 shrink-0" />
            Working files: project-assets/felix-spark-income-ideas/ · The menu is the review view, not a customer checkout.
          </p>
        </header>

        <Tabs value={selected} onValueChange={setSelected}>
          <TabsList className="grid h-auto w-full grid-cols-1 gap-1 bg-muted/60 p-1 sm:grid-cols-2 lg:grid-cols-5" aria-label="Separate offer tabs">
            {FELIX_SPARK_OFFERS.map((offer, index) => (
              <TabsTrigger key={offer.slug} value={offer.slug} className="h-auto min-h-11 justify-start whitespace-normal text-left text-xs sm:text-sm" data-testid={`offer-tab-${offer.slug}`}>
                {index + 1}. {offer.name}
              </TabsTrigger>
            ))}
          </TabsList>
          {FELIX_SPARK_OFFERS.map((offer) => (
            <TabsContent key={offer.slug} value={offer.slug} className="mt-5 space-y-4" data-testid={`offer-panel-${offer.slug}`}>
              <div className="rounded-xl border border-primary/25 bg-primary/5 p-5">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="outline">On hold · No checkout</Badge>
                  <span className="text-xs text-muted-foreground">Proposed offer {FELIX_SPARK_OFFERS.indexOf(offer) + 1} of 5</span>
                </div>
                <h2 className="mt-3 text-xl font-semibold">{offer.name}</h2>
                <p className="mt-2 max-w-3xl text-base leading-7">{offer.promise}</p>
                <p className="mt-3 text-sm text-muted-foreground"><strong className="text-foreground">Best for:</strong> {offer.buyer}</p>
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <Card>
                  <CardHeader><CardTitle className="text-base">What you give us</CardTitle></CardHeader>
                  <CardContent><ul className="list-disc space-y-2 pl-5 text-sm leading-6">{offer.buyerProvides.map((item) => <li key={item}>{item}</li>)}</ul></CardContent>
                </Card>
                <Card>
                  <CardHeader><CardTitle className="flex items-center gap-2 text-base"><PackageCheck className="h-4 w-4 text-primary" /> What you receive</CardTitle></CardHeader>
                  <CardContent><ul className="list-disc space-y-2 pl-5 text-sm leading-6">{offer.customerReceives.map((item) => <li key={item}>{item}</li>)}</ul></CardContent>
                </Card>
              </div>

              <Card>
                <CardHeader><CardTitle className="text-base">What is not included</CardTitle></CardHeader>
                <CardContent><ul className="list-disc space-y-2 pl-5 text-sm leading-6">{offer.boundaries.map((item) => <li key={item}>{item}</li>)}</ul></CardContent>
              </Card>

              <Card className="border-amber-500/30">
                <CardHeader><CardTitle className="flex items-center gap-2 text-base"><LockKeyhole className="h-4 w-4" /> Why this is on hold</CardTitle></CardHeader>
                <CardContent className="space-y-3 text-sm leading-6">
                  <p>{offer.holdReason}</p>
                  <p><strong>What must be proven next:</strong> {offer.nextProof}</p>
                  <p className="border-t pt-3 text-muted-foreground"><strong>Price idea, not a live price:</strong> {offer.proposedPrice}</p>
                </CardContent>
              </Card>
            </TabsContent>
          ))}
        </Tabs>
      </div>
    </main>
  );
}