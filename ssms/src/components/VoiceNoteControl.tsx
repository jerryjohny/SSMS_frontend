import { useI18n } from "../i18nContext";
import { useVoiceNote } from "../hooks/useVoiceNote";
import "./VoiceNoteControl.css";

export default function VoiceNoteControl({
  onTranscript,
}: {
  onTranscript: (transcript: string) => void;
}) {
  const { copy, locale } = useI18n();
  const { errorState, interimTranscript, isListening, supported, toggle } = useVoiceNote(
    locale,
    onTranscript
  );

  let statusText: string = copy.profile.voiceNoteHint;

  if (!supported) {
    statusText = copy.profile.voiceNoteUnsupported;
  } else if (errorState === "start") {
    statusText = copy.profile.voiceNoteError;
  } else if (isListening) {
    statusText = interimTranscript || copy.profile.voiceNoteListening;
  }

  return (
    <div className="voice-note-control">
      <button
        type="button"
        className={`ghost-button voice-note-control__button ${isListening ? "active" : ""}`}
        onClick={toggle}
        disabled={!supported}
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path
            d="M12 4.8a2.8 2.8 0 0 1 2.8 2.8v4.8a2.8 2.8 0 1 1-5.6 0V7.6A2.8 2.8 0 0 1 12 4.8Z"
            fill="none"
            stroke="currentColor"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="1.7"
          />
          <path
            d="M7.8 11.9a4.2 4.2 0 0 0 8.4 0M12 16.1v3.1M9.6 19.2h4.8"
            fill="none"
            stroke="currentColor"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="1.7"
          />
        </svg>
        <span>{isListening ? copy.profile.stopVoiceNote : copy.profile.startVoiceNote}</span>
      </button>
      <p
        className={`voice-note-control__status muted-text ${
          errorState === "start" || !supported ? "voice-note-control__status--error" : ""
        }`}
      >
        {statusText}
      </p>
    </div>
  );
}
