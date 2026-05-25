I will organize the online session view by separating the AI-generated clinical evolution and the audio transcription into distinct tabs. This will apply to both the post-recording view and the session details dialog.

### Implementation steps:

1. **Modify `src/pages/Teleatendimento.tsx`**:
    - Import `Tabs`, `TabsContent`, `TabsList`, and `TabsTrigger` from `@/components/ui/tabs`.
    - Update the `recordingModalContent` (post-session view) to wrap the AI content and the transcription in a `Tabs` component.
    - Update the session detail `Dialog` to also use `Tabs` to separate the clinical record from the transcription.
    - Ensure both views prominently display the AI-generated report ("parte importante") in the first tab.

2. **Verify functionality**:
    - Ensure the tabs work correctly in the preview.
    - Check that the transcription tab includes the "Copy" functionality.
    - Confirm that the AI-structured content renders correctly via `StructuredSessionContent`.

### Technical Details:
- The `Tabs` component from Radix/Shadcn UI will be used.
- Tab triggers will be "Relatório IA" (or "Evolução") and "Transcrição".
- I will ensure `StructuredSessionContent` receives the correct data from `activeSession.structuredContent` and `detailSession.structuredContent`.
