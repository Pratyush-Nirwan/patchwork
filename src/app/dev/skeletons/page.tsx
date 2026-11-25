import { notFound } from "next/navigation";
import { SkeletonGallery } from "@/components/dev/SkeletonGallery";

export const dynamic = "force-dynamic";

export default function DevSkeletonsPage() {
  if (
    process.env.NODE_ENV === "production" &&
    process.env.PATCHWORK_ENABLE_DEV_GALLERY !== "1"
  ) {
    notFound();
  }
  return <SkeletonGallery />;
}
