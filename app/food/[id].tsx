import { useEffect, useState } from 'react';
import { Alert, ScrollView, Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { createFood, getFood, softDeleteFood, updateFood } from '@/db/queries';
import { buildBasisFromLabel, type PerHundredBasis } from '@/lib/nutrition';
import { fmt, money, num } from '@/lib/format';
import { Button, Chip, DetailHeader, Field, Muted } from '@/components/ui';

type Mode = 'label' | 'per100';

export default function FoodForm() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const isNew = id === 'new';

  const [mode, setMode] = useState<Mode>('label');
  // A shared/global catalog food (user_id IS NULL) is admin-curated and read-only for users.
  const [readOnly, setReadOnly] = useState(false);
  const [name, setName] = useState('');
  const [brand, setBrand] = useState('');
  const [barcode, setBarcode] = useState('');
  const [servingSize, setServingSize] = useState('100');
  const [servingsPerPack, setServingsPerPack] = useState('1');
  const [calories, setCalories] = useState('');
  const [protein, setProtein] = useState('');
  const [carbs, setCarbs] = useState('');
  const [fat, setFat] = useState('');
  const [fiber, setFiber] = useState('');
  const [sodium, setSodium] = useState('');
  const [price, setPrice] = useState('');

  useEffect(() => {
    if (isNew) return;
    (async () => {
      const f = await getFood(id);
      if (!f) return;
      // A NULL owner means the shared/global catalog — show it read-only.
      setReadOnly(f.userId == null);
      // Existing values are already per-100 — edit them directly.
      setMode('per100');
      setName(f.name);
      setBrand(f.brand === 'Generic' ? '' : f.brand);
      setBarcode(f.barcode ?? '');
      setServingSize(String(f.servingSizeG));
      setCalories(String(f.calories));
      setProtein(String(f.proteinG));
      setCarbs(String(f.carbsG));
      setFat(String(f.fatG));
      setFiber(String(f.fiberG));
      setSodium(String(f.sodiumMg));
      setPrice(String(f.pricePer100));
    })();
  }, [id]);

  const basis: PerHundredBasis =
    mode === 'label'
      ? buildBasisFromLabel({
          servingSize: num(servingSize),
          numberOfServings: num(servingsPerPack),
          calories: num(calories),
          protein: num(protein),
          carbs: num(carbs),
          fat: num(fat),
          fiber: num(fiber),
          sodium: num(sodium),
          price: num(price),
        })
      : {
          calories: num(calories),
          proteinG: num(protein),
          carbsG: num(carbs),
          fatG: num(fat),
          fiberG: num(fiber),
          sodiumMg: num(sodium),
          pricePer100: num(price),
        };

  const save = async () => {
    if (!name.trim()) {
      Alert.alert('Name required', 'Please enter a food name.');
      return;
    }
    const payload = {
      name,
      brand,
      barcode: barcode || null,
      servingSizeG: mode === 'label' ? num(servingSize) || 100 : num(servingSize) || 100,
      basis,
    };
    if (isNew) await createFood(payload);
    else await updateFood(id, payload);
    router.back();
  };

  const remove = () => {
    Alert.alert('Delete food', `Delete “${name}”? Existing logs keep their data.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          await softDeleteFood(id);
          router.back();
        },
      },
    ]);
  };

  // Make an editable private copy of a shared food. Barcode is globally unique, so it is dropped.
  const duplicate = async () => {
    const newFoodId = await createFood({
      name,
      brand,
      barcode: null,
      servingSizeG: num(servingSize) || 100,
      basis,
    });
    router.replace({ pathname: '/food/[id]', params: { id: newFoodId } });
  };

  const priceLabel = mode === 'label' ? 'Total package price' : 'Price per 100g';
  const nutrientHint = mode === 'label' ? '(as printed, per serving)' : '(per 100g)';

  return (
    <View className="flex-1 bg-paper">
      <DetailHeader title={readOnly ? 'Food details' : isNew ? 'Add food' : 'Edit food'} />
      <ScrollView className="flex-1" contentContainerClassName="p-4 pb-16 gap-3">
      {readOnly ? (
        <View className="rounded-2xl bg-[#FBF3E4] border border-[#EAD9B8] p-[14px]">
          <Text className="font-body-sb text-[13px] text-[#7A5A1E] leading-5">
            Shared catalog food — read-only. Tap “Duplicate to my foods” to make an editable copy.
          </Text>
        </View>
      ) : null}
      <Field label="Name" placeholder="e.g. whey_protein_on" value={name} onChangeText={setName} autoCapitalize="none" editable={!readOnly} />
      <Field label="Brand (optional)" placeholder="Generic" value={brand} onChangeText={setBrand} editable={!readOnly} />
      <Field label="Barcode (optional)" placeholder="UPC" value={barcode} onChangeText={setBarcode} keyboardType="numbers-and-punctuation" editable={!readOnly} />

      {!readOnly ? (
        <View>
          <Text className="font-body-sb text-[12.5px] text-ink2 mb-[6px]">Entry mode</Text>
          <View className="flex-row">
            <Chip label="From label (per serving)" active={mode === 'label'} onPress={() => setMode('label')} />
            <Chip label="Per 100g" active={mode === 'per100'} onPress={() => setMode('per100')} />
          </View>
        </View>
      ) : null}

      <View className="flex-row gap-3">
        <Field label={mode === 'label' ? 'Serving size (g/ml)' : 'Serving size (g/ml)'} value={servingSize} onChangeText={setServingSize} keyboardType="decimal-pad" className="flex-1" editable={!readOnly} />
        {mode === 'label' ? (
          <Field label="Servings / pack" value={servingsPerPack} onChangeText={setServingsPerPack} keyboardType="decimal-pad" className="flex-1" editable={!readOnly} />
        ) : (
          <View className="flex-1" />
        )}
      </View>

      <Muted className="text-xs -mb-1">Nutrients {nutrientHint}</Muted>
      <View className="flex-row gap-3">
        <Field label="Calories" value={calories} onChangeText={setCalories} keyboardType="decimal-pad" className="flex-1" editable={!readOnly} />
        <Field label="Protein (g)" value={protein} onChangeText={setProtein} keyboardType="decimal-pad" className="flex-1" editable={!readOnly} />
      </View>
      <View className="flex-row gap-3">
        <Field label="Carbs (g)" value={carbs} onChangeText={setCarbs} keyboardType="decimal-pad" className="flex-1" editable={!readOnly} />
        <Field label="Fat (g)" value={fat} onChangeText={setFat} keyboardType="decimal-pad" className="flex-1" editable={!readOnly} />
      </View>
      <View className="flex-row gap-3">
        <Field label="Fiber (g)" value={fiber} onChangeText={setFiber} keyboardType="decimal-pad" className="flex-1" editable={!readOnly} />
        <Field label="Sodium (mg)" value={sodium} onChangeText={setSodium} keyboardType="decimal-pad" className="flex-1" editable={!readOnly} />
      </View>
      <Field label={priceLabel} value={price} onChangeText={setPrice} keyboardType="decimal-pad" editable={!readOnly} />

      {/* Live per-100 preview */}
      <View className="mt-1 rounded-2xl bg-[#EAF7EC] border border-[#CDE8D2] p-[14px]">
        <Text className="font-display-sb text-[13px] text-brand-ink mb-1">STORED AS (PER 100g)</Text>
        <Text className="font-body-sb text-[13.5px] text-[#245C33] leading-5">
          {fmt(basis.calories, 1)} kcal · P {fmt(basis.proteinG, 1)} · C {fmt(basis.carbsG, 1)} · F{' '}
          {fmt(basis.fatG, 1)} · Fib {fmt(basis.fiberG, 1)} · Na {fmt(basis.sodiumMg, 1)}mg ·{' '}
          {money(basis.pricePer100)}/100g
        </Text>
      </View>

      {readOnly ? (
        <Button label="Duplicate to my foods" onPress={duplicate} className="mt-2" />
      ) : (
        <>
          <Button label={isNew ? 'Add food' : 'Save changes'} onPress={save} className="mt-2" />
          {!isNew ? <Button label="Delete food" variant="danger" onPress={remove} /> : null}
        </>
      )}
      </ScrollView>
    </View>
  );
}
