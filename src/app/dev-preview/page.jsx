import {notFound} from 'next/navigation';
import {previewSettings} from '@/lib/preview-state';
import ResponsivePreview from '@/components/dev/ResponsivePreview';

export const dynamic='force-dynamic';
export const metadata={title:'Phone & tablet · Local preview'};
export default async function PreviewPage({searchParams}){
  if(process.env.NODE_ENV!=='development')notFound();
  const query=await searchParams;
  return <ResponsivePreview initialSettings={previewSettings(query)}/>;
}
