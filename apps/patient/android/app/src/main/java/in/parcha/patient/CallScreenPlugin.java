package in.parcha.patient;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Build;
import android.provider.Settings;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONArray;

/**
 * Ringing the phone for a dose, and handing back what was answered.
 *
 * The screen itself is `CallActivity`. This is the doorway from the web app:
 * `ring` to start one, `pending`/`clear` to collect the answers it wrote while
 * the app was closed, and `canRing` so a screen can say plainly when Android
 * has not granted the permission rather than failing silently.
 *
 * Two ways in, on purpose. A full-screen-intent notification is the one that
 * matters, because it fires over a lock screen with the app dead. From
 * Android 14 that permission is reserved for apps Android thinks are alarms
 * or dialers, and everyone else has to send the person to a settings page for
 * it. So when it is not granted we start the activity directly, which works
 * whenever Parcha is already open — enough to show the thing, never enough to
 * wake a sleeping phone. `canRing` is how the app knows which it has.
 */
@CapacitorPlugin(name = "CallScreen")
public class CallScreenPlugin extends Plugin {

  private static final String CHANNEL = "parcha-call";
  private static final int NOTIFICATION_ID = 7714;

  private void ensureChannel() {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
    NotificationManager manager = (NotificationManager) getContext().getSystemService(Context.NOTIFICATION_SERVICE);
    if (manager == null || manager.getNotificationChannel(CHANNEL) != null) return;
    NotificationChannel channel =
        new NotificationChannel(CHANNEL, "Medicine calls", NotificationManager.IMPORTANCE_HIGH);
    channel.setDescription("A medicine reminder that takes the whole screen, like a call.");
    channel.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);
    channel.enableVibration(true);
    manager.createNotificationChannel(channel);
  }

  private boolean fullScreenAllowed() {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.UPSIDE_DOWN_CAKE) return true;
    NotificationManager manager = (NotificationManager) getContext().getSystemService(Context.NOTIFICATION_SERVICE);
    return manager != null && manager.canUseFullScreenIntent();
  }

  private Intent screenFor(PluginCall call) {
    Intent intent = new Intent(getContext(), CallActivity.class);
    intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
    intent.putExtra("title", call.getString("title", ""));
    intent.putExtra("person", call.getString("person", ""));
    intent.putExtra("detail", call.getString("detail", ""));
    intent.putExtra("time", call.getString("time", ""));
    intent.putExtra("key", call.getString("key", ""));
    intent.putExtra("date", call.getString("date", ""));
    intent.putExtra("lang", call.getString("lang", "hi"));
    return intent;
  }

  /** Whether a dose can ring over a locked screen, or only while Parcha is open. */
  @PluginMethod
  public void canRing(PluginCall call) {
    JSObject out = new JSObject();
    out.put("overLockScreen", fullScreenAllowed());
    call.resolve(out);
  }

  /** Sends the person to the one settings page that can grant it (Android 14+). */
  @PluginMethod
  public void requestPermission(PluginCall call) {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE && !fullScreenAllowed()) {
      try {
        Intent intent = new Intent(Settings.ACTION_MANAGE_APP_USE_FULL_SCREEN_INTENT);
        intent.setData(android.net.Uri.parse("package:" + getContext().getPackageName()));
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        getContext().startActivity(intent);
      } catch (Exception ignored) {
        /* no such settings screen on this build: nothing to open */
      }
    }
    call.resolve();
  }

  /** Rings the phone for one dose. */
  @PluginMethod
  public void ring(PluginCall call) {
    ensureChannel();
    Intent screen = screenFor(call);
    int flags = PendingIntent.FLAG_UPDATE_CURRENT
        | (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M ? PendingIntent.FLAG_IMMUTABLE : 0);
    PendingIntent pending = PendingIntent.getActivity(getContext(), NOTIFICATION_ID, screen, flags);

    // With Parcha in front — which is the case whenever somebody taps the
    // button on a medicine — start the screen outright. A notification is the
    // wrong tool here: on Android 13 and later the system drops it silently
    // when notification permission was never granted, so the phone that was
    // asked to ring simply does nothing. Starting the activity needs no
    // permission at all and cannot be dropped.
    boolean overLockScreen = fullScreenAllowed();
    if (getActivity() != null && !getActivity().isFinishing()) {
      getActivity().startActivity(screen);
      JSObject now = new JSObject();
      now.put("overLockScreen", overLockScreen);
      call.resolve(now);
      return;
    }

    if (overLockScreen) {
      Notification.Builder builder =
          Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
              ? new Notification.Builder(getContext(), CHANNEL)
              : new Notification.Builder(getContext());
      builder
          .setSmallIcon(android.R.drawable.ic_menu_call)
          .setContentTitle(call.getString("title", "Medicine"))
          .setContentText(call.getString("person", ""))
          .setCategory(Notification.CATEGORY_ALARM)
          .setAutoCancel(true)
          .setOngoing(false)
          .setFullScreenIntent(pending, true);
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
        builder.setVisibility(Notification.VISIBILITY_PUBLIC);
      }
      NotificationManager manager = (NotificationManager) getContext().getSystemService(Context.NOTIFICATION_SERVICE);
      if (manager != null) manager.notify(NOTIFICATION_ID, builder.build());
    } else {
      // No permission for the lock screen: show it the only way left.
      getContext().startActivity(screen);
    }

    JSObject out = new JSObject();
    out.put("overLockScreen", overLockScreen);
    call.resolve(out);
  }

  /** The answers written while the app was closed, oldest first. */
  @PluginMethod
  public void pending(PluginCall call) {
    SharedPreferences prefs = getContext().getSharedPreferences(CallActivity.PREFS, Context.MODE_PRIVATE);
    String raw = prefs.getString(CallActivity.PENDING, "[]");
    JSObject out = new JSObject();
    try {
      out.put("answers", new JSArrayWrapper(raw).array());
    } catch (Exception e) {
      out.put("answers", new JSONArray());
    }
    call.resolve(out);
  }

  /** Forgets them, once the app has taken them into its own outbox. */
  @PluginMethod
  public void clear(PluginCall call) {
    getContext()
        .getSharedPreferences(CallActivity.PREFS, Context.MODE_PRIVATE)
        .edit()
        .remove(CallActivity.PENDING)
        .apply();
    call.resolve();
  }

  /** A JSONArray from stored text, or an empty one; never a crash on bad data. */
  private static final class JSArrayWrapper {
    private final JSONArray value;

    JSArrayWrapper(String raw) {
      JSONArray parsed;
      try {
        parsed = new JSONArray(raw);
      } catch (Exception e) {
        parsed = new JSONArray();
      }
      value = parsed;
    }

    JSONArray array() {
      return value;
    }
  }
}
