package in.parcha.patient;

import android.app.Activity;
import android.app.KeyguardManager;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.media.MediaRecorder;
import android.util.Base64;
import android.widget.ImageView;
import java.io.File;
import java.io.FileInputStream;
import android.media.AudioAttributes;
import android.media.AudioManager;
import android.media.Ringtone;
import android.media.RingtoneManager;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.VibrationEffect;
import android.os.Vibrator;
import android.speech.tts.TextToSpeech;
import android.view.View;
import android.view.WindowManager;
import android.widget.Button;
import android.widget.TextView;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.Locale;

/**
 * The medicine reminder, as a call.
 *
 * An older patient may not read a screen or feel a buzz in a pocket, but
 * everybody answers a ringing phone. So a dose that falls due does not arrive
 * as a line in the notification tray: it takes the whole screen, over the lock
 * screen, with the phone ringing and buzzing, and the medicine said out loud
 * in her own language. Three answers, and no way to miss it: taken, not
 * taken (asked again in thirty minutes), or a few seconds of her voice for the
 * family: "the tablets are finished", "I feel dizzy", "call me".
 *
 * It is not a telephone call, and nothing here pretends otherwise — it is this
 * phone's own alarm wearing a call's clothes. That is a deliberate trade: no
 * network is needed, no telecom rules apply, nothing costs a paisa per ring,
 * and it works with the SIM out. What it gives up is reaching a phone that
 * does not have Parcha on it, which is what the real calling agent is still
 * for (`docs/CALLING.md`).
 *
 * The answer is written to this phone before anything else happens, because
 * the app may not be running and the network may be gone. The web app drains
 * it into its own outbox the next time it opens, which is where every other
 * offline action already waits.
 */
public class CallActivity extends Activity implements TextToSpeech.OnInitListener {

  public static final String PREFS = "parcha.callscreen";
  public static final String PENDING = "pending";

  private Ringtone ringtone;
  private Vibrator vibrator;
  private TextToSpeech speaker;
  private String spoken;
  private String language = "hi";
  private static final int MIC = 7;
  private static final int MAX_SECONDS = 30;
  private MediaRecorder recorder;
  private File clip;
  private long recordingSince;
  private String key = "";
  private String date = "";
  private String person = "";
  private Button recordButton;
  private TextView recordNote;

  @Override
  protected void onCreate(Bundle saved) {
    super.onCreate(saved);

    // Over the lock screen, and the screen turned on: this is the whole point.
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
      setShowWhenLocked(true);
      setTurnScreenOn(true);
      KeyguardManager keyguard = (KeyguardManager) getSystemService(Context.KEYGUARD_SERVICE);
      if (keyguard != null) keyguard.requestDismissKeyguard(this, null);
    } else {
      getWindow().addFlags(
          WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED
              | WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON
              | WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
    }
    getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);

    setContentView(R.layout.activity_call);

    Intent from = getIntent();
    final String title = text(from, "title", "Your medicine");
    person = text(from, "person", "");
    final String detail = text(from, "detail", "");
    final String time = text(from, "time", "");
    key = text(from, "key", "");
    date = text(from, "date", "");
    language = text(from, "lang", "hi");

    ((TextView) findViewById(R.id.call_who)).setText(person.isEmpty() ? title : person);
    ((TextView) findViewById(R.id.call_title)).setText(title);
    TextView sub = findViewById(R.id.call_detail);
    String under = detail.isEmpty() ? time : (time.isEmpty() ? detail : time + " · " + detail);
    sub.setText(under);
    sub.setVisibility(under.isEmpty() ? View.GONE : View.VISIBLE);
    ((TextView) findViewById(R.id.call_from)).setText(label("Parcha · medicine reminder", "पर्चा · दवा का रिमाइंडर"));

    // The strip, if the app sent its photo: the picture is what she knows.
    String photo = text(from, "photo", "");
    if (!photo.isEmpty()) {
      try {
        byte[] bytes = Base64.decode(photo.substring(photo.indexOf(',') + 1), Base64.DEFAULT);
        Bitmap strip = BitmapFactory.decodeByteArray(bytes, 0, bytes.length);
        if (strip != null) {
          ImageView view = findViewById(R.id.call_strip);
          view.setImageBitmap(strip);
          view.setVisibility(View.VISIBLE);
        }
      } catch (Exception ignored) {
        /* no picture is better than a broken one */
      }
    }

    Button taken = findViewById(R.id.call_taken);
    Button later = findViewById(R.id.call_later);
    recordButton = findViewById(R.id.call_record);
    recordNote = findViewById(R.id.call_record_note);
    taken.setText(label("Yes, taken", "हाँ, ले ली"));
    later.setText(label("No, not taken", "नहीं ली"));
    recordButton.setText(label("Record a message", "संदेश रिकॉर्ड करें"));
    recordNote.setText(label("For the family. Not an emergency call.", "परिवार के लिए। यह आपातकालीन कॉल नहीं है।"));

    spoken = said(title, person);

    ring();
    speaker = new TextToSpeech(this, this);

    taken.setOnClickListener(v -> answer(key, date, "taken"));
    later.setOnClickListener(v -> answer(key, date, "not_taken"));
    recordButton.setOnClickListener(v -> {
      if (recorder != null) stopRecording();
      else if (checkSelfPermission(android.Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) startRecording();
      else requestPermissions(new String[] {android.Manifest.permission.RECORD_AUDIO}, MIC);
    });
  }

  @Override
  public void onRequestPermissionsResult(int code, String[] permissions, int[] results) {
    super.onRequestPermissionsResult(code, permissions, results);
    if (code != MIC) return;
    if (results.length > 0 && results[0] == PackageManager.PERMISSION_GRANTED) startRecording();
    else recordNote.setText(label("Parcha may not use the microphone. Allow it in settings.", "Parcha को माइक की इजाज़त नहीं है। सेटिंग में दें।"));
  }

  /** Quiet first (the ring and the voice would be recorded over her), then up to thirty seconds. */
  private void startRecording() {
    silence();
    try {
      clip = new File(getCacheDir(), "message-" + System.currentTimeMillis() + ".m4a");
      recorder = new MediaRecorder();
      recorder.setAudioSource(MediaRecorder.AudioSource.MIC);
      recorder.setOutputFormat(MediaRecorder.OutputFormat.MPEG_4);
      recorder.setAudioEncoder(MediaRecorder.AudioEncoder.AAC);
      recorder.setAudioSamplingRate(16000);
      recorder.setAudioChannels(1);
      recorder.setAudioEncodingBitRate(24000);
      recorder.setMaxDuration(MAX_SECONDS * 1000);
      recorder.setOutputFile(clip.getAbsolutePath());
      recorder.setOnInfoListener((r, what, extra) -> {
        if (what == MediaRecorder.MEDIA_RECORDER_INFO_MAX_DURATION_REACHED) stopRecording();
      });
      recorder.prepare();
      recorder.start();
      recordingSince = System.currentTimeMillis();
      recordButton.setText(label("Stop and keep the message", "रोकें और संदेश रखें"));
      recordButton.setBackgroundColor(0xFFB3261E);
      recordNote.setText(label("Speak now. Up to 30 seconds.", "अब बोलिए। 30 सेकंड तक।"));
    } catch (Exception e) {
      recorder = null;
      recordNote.setText(label("The microphone could not start.", "माइक शुरू नहीं हो पाया।"));
    }
  }

  /** Kept on this phone with the answers; the app sends it to the family when it next opens. */
  private void stopRecording() {
    if (recorder == null) return;
    int seconds = (int) Math.max(1, (System.currentTimeMillis() - recordingSince) / 1000);
    try {
      recorder.stop();
    } catch (Exception ignored) {
      /* too short to keep */
    }
    recorder.release();
    recorder = null;
    try {
      byte[] bytes = new byte[(int) clip.length()];
      try (FileInputStream in = new FileInputStream(clip)) {
        int read = 0;
        while (read < bytes.length) {
          int n = in.read(bytes, read, bytes.length - read);
          if (n < 0) break;
          read += n;
        }
      }
      clip.delete();
      if (bytes.length < 800) throw new Exception("empty");
      JSONObject row = new JSONObject();
      row.put("key", key);
      row.put("date", date);
      row.put("outcome", "message");
      row.put("person", person);
      row.put("seconds", seconds);
      row.put("id", "m_" + System.currentTimeMillis());
      row.put("audio", "data:audio/mp4;base64," + Base64.encodeToString(bytes, Base64.NO_WRAP));
      row.put("at", System.currentTimeMillis());
      queue(row);
      recordButton.setText(label("Message kept", "संदेश रख लिया"));
      recordButton.setEnabled(false);
      recordButton.setBackgroundColor(0xFF6B5B52);
      recordNote.setText(label("The family will hear it. Now: did you take the medicine?", "परिवार इसे सुनेगा। अब बताइए: दवा ली?"));
    } catch (Exception e) {
      recordNote.setText(label("Nothing was recorded. Try again.", "कुछ रिकॉर्ड नहीं हुआ। फिर कोशिश करें।"));
      recordButton.setText(label("Record a message", "संदेश रिकॉर्ड करें"));
      recordButton.setBackgroundColor(0xFFFF7F5A);
    }
  }

  private void silence() {
    try {
      if (ringtone != null && ringtone.isPlaying()) ringtone.stop();
      if (vibrator != null) vibrator.cancel();
      if (speaker != null) speaker.stop();
    } catch (Exception ignored) {
    }
  }

  private String text(Intent i, String name, String fallback) {
    String v = i == null ? null : i.getStringExtra(name);
    return v == null ? fallback : v;
  }

  private String label(String en, String hi) {
    return "hi".equals(language) ? hi : en;
  }

  /**
   * What the phone says out loud: one sentence, and not the medicine's name.
   * A drug name read by a phone is noise to her; the strip on the screen says
   * which one. Nothing is asked and nothing is answered by voice: the buttons
   * are the conversation.
   */
  private String said(String title, String person) {
    if ("hi".equals(language)) {
      return "आपकी दवाई का समय हो गया है।";
    }
    return "It is time for your medicine.";
  }

  /** A woman's voice in the language, where the phone has one; otherwise its default. */
  private void preferFemaleVoice(Locale want) {
    try {
      android.speech.tts.Voice best = null;
      for (android.speech.tts.Voice v : speaker.getVoices()) {
        if (!v.getLocale().getLanguage().equals(want.getLanguage())) continue;
        String name = v.getName().toLowerCase(Locale.ROOT);
        boolean female = name.contains("female") || name.contains("-hia") || name.contains("-hic") || name.contains("x-iol") || name.contains("x-ahp");
        boolean local = !v.isNetworkConnectionRequired();
        if (female && local) {
          best = v;
          break;
        }
        if (female && best == null) best = v;
      }
      if (best != null) speaker.setVoice(best);
    } catch (Exception ignored) {
      /* the default voice still speaks */
    }
  }

  /** The phone's own ringtone and a long buzz, the way a call arrives. */
  private void ring() {
    try {
      ringtone = RingtoneManager.getRingtone(this, RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE));
      if (ringtone != null) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
          ringtone.setAudioAttributes(
              new AudioAttributes.Builder()
                  .setUsage(AudioAttributes.USAGE_NOTIFICATION_RINGTONE)
                  .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                  .build());
        }
        ringtone.play();
      }
    } catch (Exception ignored) {
      /* a phone with no ringtone still shows the screen */
    }
    try {
      vibrator = (Vibrator) getSystemService(Context.VIBRATOR_SERVICE);
      long[] pattern = {0, 700, 600, 700, 600};
      if (vibrator != null && vibrator.hasVibrator()) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
          vibrator.vibrate(VibrationEffect.createWaveform(pattern, 1));
        } else {
          vibrator.vibrate(pattern, 1);
        }
      }
    } catch (Exception ignored) {
      /* no vibrator: the ring and the screen are enough */
    }
  }

  @Override
  public void onInit(int status) {
    if (status != TextToSpeech.SUCCESS || speaker == null) return;
    try {
      Locale want = "hi".equals(language) ? new Locale("hi", "IN") : new Locale("en", "IN");
      int ok = speaker.setLanguage(want);
      // A phone with no Hindi voice says it in English rather than nothing.
      if (ok == TextToSpeech.LANG_MISSING_DATA || ok == TextToSpeech.LANG_NOT_SUPPORTED) {
        speaker.setLanguage(Locale.ENGLISH);
      } else {
        preferFemaleVoice(want);
      }
      // After the first rings, the way a voice comes on once the call connects.
      new Handler(Looper.getMainLooper()).postDelayed(() -> {
        try {
          if (ringtone != null && ringtone.isPlaying()) ringtone.stop();
          speaker.speak(spoken, TextToSpeech.QUEUE_FLUSH, null, "parcha-dose");
        } catch (Exception ignored) {
        }
      }, 2600);
    } catch (Exception ignored) {
    }
  }

  /**
   * The answer, written to this phone first. Nothing is sent from here: the
   * app may be closed and the network may be gone, and a reminder that loses
   * an answer is worse than one that arrives late.
   */
  private void answer(String key, String date, String outcome) {
    // A message half-recorded is kept, not lost, when she answers mid-way.
    if (recorder != null) stopRecording();
    try {
      JSONObject row = new JSONObject();
      row.put("key", key);
      row.put("date", date);
      row.put("outcome", outcome);
      row.put("at", System.currentTimeMillis());
      queue(row);
    } catch (Exception ignored) {
      /* storage refused: the dose can still be ticked in the app */
    }
    finish();
  }

  private void queue(JSONObject row) {
    SharedPreferences prefs = getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    JSONArray queue;
    try {
      queue = new JSONArray(prefs.getString(PENDING, "[]"));
    } catch (Exception e) {
      queue = new JSONArray();
    }
    queue.put(row);
    prefs.edit().putString(PENDING, queue.toString()).commit();
  }

  @Override
  protected void onDestroy() {
    if (recorder != null) {
      try {
        recorder.release();
      } catch (Exception ignored) {
      }
      recorder = null;
    }
    try {
      if (ringtone != null && ringtone.isPlaying()) ringtone.stop();
    } catch (Exception ignored) {
    }
    try {
      if (vibrator != null) vibrator.cancel();
    } catch (Exception ignored) {
    }
    try {
      if (speaker != null) {
        speaker.stop();
        speaker.shutdown();
      }
    } catch (Exception ignored) {
    }
    super.onDestroy();
  }

  /** The back button does not dismiss a dose silently; Later is an answer. */
  @Override
  public void onBackPressed() {
    // Deliberately empty: the answers are the way out.
  }
}
