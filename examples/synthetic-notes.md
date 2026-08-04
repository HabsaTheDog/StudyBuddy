# Synthetic study notes: RC low-pass filter

An RC low-pass filter contains a resistor in series and a capacitor to ground.
Its cutoff frequency is `f_c = 1 / (2 pi R C)`. Well below the cutoff, the
output follows the input. Well above the cutoff, the magnitude decreases at
approximately 20 dB per decade and the capacitor shunts more of the signal to
ground.

Example: for `R = 1 kOhm` and `C = 100 nF`, the cutoff is approximately
`1.59 kHz`.
