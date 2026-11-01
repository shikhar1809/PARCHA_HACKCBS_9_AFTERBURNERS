package in.parcha.patient;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
  @Override
  public void onCreate(Bundle savedInstanceState) {
    // The medicine reminder that takes the whole screen, like a call.
    registerPlugin(CallScreenPlugin.class);
    super.onCreate(savedInstanceState);
  }
}
