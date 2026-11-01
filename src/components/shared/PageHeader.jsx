import React from "react";
import PageBackButton from './PageBackButton';

const hasContent = children => React.Children.toArray(children).some(child =>
  React.isValidElement(child) && (child.type === 'div' || child.type === React.Fragment)
    ? hasContent(child.props.children) : child !== '');

export default function PageHeader({ title, subtitle, actions, back }) {
  return (
    <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 mb-6">
      <div data-page-heading className="flex min-w-0 items-start gap-2">
        {back && <PageBackButton {...back} />}
        <div className="min-w-0 self-center">
          <h1 className="break-words text-2xl font-bold text-foreground tracking-tight">{title}</h1>
          {subtitle && <p className="text-sm text-slate-500 mt-1">{subtitle}</p>}
        </div>
      </div>
      {hasContent(actions) && <div data-page-actions className="flex min-w-0 max-w-full flex-wrap items-center gap-2 sm:shrink-0">{actions}</div>}
    </div>
  );
}
