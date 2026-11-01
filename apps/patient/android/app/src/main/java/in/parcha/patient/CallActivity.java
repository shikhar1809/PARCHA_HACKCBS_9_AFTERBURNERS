package in.parcha.patient;

import android.app.Activity;
import android.app.KeyguardManager;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
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
 * in her own language. Two buttons, and no way to miss it.
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
    final String person = text(from, "person", "");
    final String detail = text(from, "detail", "");
    final String time = text(from, "time", "");
    final String key = text(from, "key", "");
    final String date = text(from, "date", "");
    language = text(from, "lang", "hi");

    ((TextView) findViewById(R.id.call_who)).setText(person.isEmpty() ? title : person);
    ((TextView) findViewById(R.id.call_title)).setText(title);
    TextView sub = findViewById(R.id.call_detail);
    String under = detail.isEmpty() ? time : (time.isEmpty() ? detail : time + " · " + detail);
    sub.setText(under);
    sub.setVisibility(under.isEmpty() ? View.GONE : View.VISIBLE);
    ((TextView) findViewById(R.id.call_from)).setText(label("Parcha · medicine reminder", "पर्चा · दवा का रिमाइंडर"));

    Button taken = findViewById(R.id.call_taken);
    Button later = findViewById(R.id.call_later);
    taken.setText(label("Taken", "ले ली"));
    later.setText(label("Later", "बाद में"));

    spoken = said(title, person);

    ring();
    speaker = new TextToSpeech(this, this);

    taken.setOnClickListener(v -> answer(key, date, "taken"));
    later.setOnClickListener(v -> answer(key, date, "snoozed"));
  }

  private String text(Intent i, String name, String fallback) {
    String v = i == null ? null : i.getStringExtra(name);
    return v == null ? fallback : v;
  }

  private String label(String en, String hi) {
    return "hi".equals(language) ? hi : en;
  }

  /**
   * What the phone says out loud. One sentence, then the medicine — the same
   * words the telephone call uses, so a family hears the same thing whichever
   * way the reminder reaches them. Nothing is asked and nothing is answered
   * by voice: the two buttons are the conversation.
   */
  private String said(String title, String person) {
    if ("hi".equals(language)) {
      return "आपकी दवाई का समय हो गया। " + title + "।";
    }
    return "It is time for your medicine. " + title + ".";
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
    try {
      SharedPreferences prefs = getSharedPreferences(PREFS, Context.MODE_PRIVATE);
      JSONArray queue;
      try {
        queue = new JSONArray(prefs.getString(PENDING, "[]"));
      } catch (Exception e) {
        queue = new JSONArray();
      }
      JSONObject row = new JSONObject();
      row.put("key", key);
      row.put("date", date);
      row.put("outcome", outcome);
      row.put("at", System.currentTimeMillis());
      queue.put(row);
      prefs.edit().putString(PENDING, queue.toString()).apply();
    } catch (Exception ignored) {
      /* storage refused: the dose can still be ticked in the app */
    }
    finish();
  }

  @Override
  protected void onDestroy() {
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
    // Deliberately empty: the two buttons are the way out.
  }
}
